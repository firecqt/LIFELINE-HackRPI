/**
 * Live link between frontend searches and the backend engine.
 *
 *   createEngineSearch  POST /api/sim → build terrain/report/mission/session from the response
 *   Launch (store.start) open WS /ws/sim/stream → POST /api/sim/stream → frames drive the sim
 *   Restart (store.reset) DELETE /api/sim/stream, local state back to tick 0
 *
 * The server streams one simulation at a time to one client, so starting a search replaces
 * whatever engine search was streaming before.
 */
import { create } from 'zustand';
import type { CreateSimResponse, SimFrame } from './contract';
import { BackendError, FrameSocket, createSim, startStream, stopStream, type SocketState } from './backendClient';
import { buildBackendSearch, frameFromWire, toPoint } from './backendAdapter';
import { engineDriven, engineDroneTemplates, engineEnded, engineHandlers } from './engineRegistry';
import { useAppStore } from '../store/appStore';
import { applyEngineFrame, BASE_TICK_MS } from '../services/simulationService';

export type LinkStatus = 'ready' | 'starting' | 'streaming' | 'finished' | 'stopped' | 'replaced' | 'error';

export interface EngineLink {
  missionId: string;
  simID: string;
  isReal: boolean;
  params: CreateSimResponse['params'];
  hikerStart: { x: number; y: number } | null;
  hikerEnd: { x: number; y: number } | null;
  hikerCurrent: { x: number; y: number } | null;
  /** Hiker positions seen on the stream, for drawing the engine trajectory. */
  trail: { x: number; y: number }[];
  tick: number;
  tickRate: number | null;
  droneIds: string[];
  status: LinkStatus;
  frames: number;
  lastFrameAt: number | null;
  error: string | null;
  createdAt: number;
}

interface LinkState {
  links: Record<string, EngineLink>;
  socket: SocketState;
  socketError: string | null;
  patch: (missionId: string, p: Partial<EngineLink>) => void;
}

export const useEngineLinks = create<LinkState>((set) => ({
  links: {},
  socket: 'closed',
  socketError: null,
  patch: (missionId, p) => set((st) => (st.links[missionId] ? { links: { ...st.links, [missionId]: { ...st.links[missionId], ...p } } } : st)),
}));

const patch = (id: string, p: Partial<EngineLink>) => useEngineLinks.getState().patch(id, p);
const errorText = (e: unknown) => (e instanceof BackendError || e instanceof Error ? e.message : String(e));

// ---- Frames ---------------------------------------------------------------------------------

function onFrame(wire: SimFrame) {
  const link = Object.values(useEngineLinks.getState().links).find((l) => l.simID === wire.simID);
  // The server replays its latest frame on connect; ignore frames for searches not streaming.
  if (!link || (link.status !== 'streaming' && link.status !== 'starting')) return;
  const sess = useAppStore.getState().sessions[link.missionId];
  if (!sess) return;
  // Subject found or search stood down here: nothing left for the engine to run.
  if (sess.sim.status === 'complete') {
    patch(link.missionId, { status: 'stopped' });
    engineEnded.add(link.missionId);
    stopStream().catch(() => {});
    maybeCloseSocket();
    return;
  }
  const f = frameFromWire(wire);
  const ended = f.status !== 'running';
  const last = link.trail[link.trail.length - 1];
  const trail = f.hiker && (!last || last.x !== f.hiker.x || last.y !== f.hiker.y) ? [...link.trail, f.hiker] : link.trail;
  patch(link.missionId, {
    status: ended ? (f.status === 'stopped' ? 'stopped' : 'finished') : 'streaming',
    tick: f.tick,
    hikerCurrent: f.hiker ?? link.hikerCurrent,
    trail,
    droneIds: f.drones.map((d) => d.id),
    frames: link.frames + 1,
    lastFrameAt: Date.now(),
    error: null,
  });
  if (ended) engineEnded.add(link.missionId);
  const templates = engineDroneTemplates.get(link.missionId) ?? sess.sim.drones;
  useAppStore.getState().ingest(link.missionId, applyEngineFrame(sess.sim, sess.env, f, templates));
  if (ended) maybeCloseSocket();
}

const socket = new FrameSocket(onFrame, (state, error) => useEngineLinks.setState({ socket: state, socketError: error }));

function maybeCloseSocket() {
  const live = Object.values(useEngineLinks.getState().links).some((l) => l.status === 'streaming' || l.status === 'starting');
  if (!live) socket.close();
}

// ---- Commands -------------------------------------------------------------------------------

export interface CreateEngineSearchInput {
  isReal: boolean;
  N: number;
  offset: number;
  seed: number | null;
  maxTimestep: number;
  cellSizeM: number;
  hoursMissing: number;
  droneCount: number;
}

/** POST /api/sim and register the result as a search the whole app can show. */
export async function createEngineSearch(input: CreateEngineSearchInput): Promise<string> {
  const app = useAppStore.getState();
  const drones = app.getAvailableDrones().slice(0, input.droneCount);
  if (!drones.length) throw new Error('No drones are free. Stand down another search first.');
  const created = await createSim({ isReal: input.isReal, N: input.N, offset: input.offset, seed: input.seed, maxTimestep: input.maxTimestep });
  const n = app.missions.filter((m) => m.id.startsWith('E-')).length + 1;
  const missionId = `E-${String(n).padStart(3, '0')}`;
  const search = buildBackendSearch({ created, isReal: input.isReal, cellSizeM: input.cellSizeM, hoursMissing: input.hoursMissing, missionId, drones });

  engineDriven.add(missionId);
  // The engine supplies the drones; local airframes only lend sensor specs and colours.
  engineDroneTemplates.set(missionId, search.sim.drones);
  search.sim.drones = [];
  search.mission.dronesAssigned = [];
  useAppStore.setState((st) => ({ reports: [search.report, ...st.reports] }));
  useAppStore.getState().registerMission(search.mission, search.env, search.sim);
  const start = toPoint(created.hiker.start);
  useEngineLinks.setState((st) => ({
    links: {
      ...st.links,
      [missionId]: {
        missionId,
        simID: created.simID,
        isReal: input.isReal,
        params: created.params,
        hikerStart: start,
        hikerEnd: toPoint(created.hiker.end),
        hikerCurrent: start,
        trail: start ? [start] : [],
        tick: 0,
        tickRate: null,
        droneIds: [],
        status: 'ready',
        frames: 0,
        lastFrameAt: null,
        error: null,
        createdAt: Date.now(),
      },
    },
  }));
  return missionId;
}

/** Map speed (1×, 2×…) to engine ticks per second, matching the local sim's pace. */
export const tickRateFor = (speed: number) => Math.min(60, Math.round(((1000 / BASE_TICK_MS) * speed) * 100) / 100);

async function launch(missionId: string, speed: number) {
  const link = useEngineLinks.getState().links[missionId];
  if (!link || link.status === 'starting' || link.status === 'streaming') return;
  const resuming = link.status === 'finished' || link.status === 'stopped' || link.status === 'replaced';
  if (resuming) {
    // The engine always starts a sim from tick 0, so the local search starts over too.
    useAppStore.getState().reset(missionId);
  }
  engineEnded.delete(missionId);
  // Only one engine stream at a time: mark the previous one as replaced.
  for (const l of Object.values(useEngineLinks.getState().links)) {
    if (l.missionId !== missionId && (l.status === 'streaming' || l.status === 'starting')) {
      patch(l.missionId, { status: 'replaced', error: 'Another engine search started streaming' });
      engineEnded.add(l.missionId);
      const s = useAppStore.getState().sessions[l.missionId];
      if (s && s.sim.status === 'running' && !s.sim.signals.some((g) => g.status === 'verifying' || g.status === 'on_scene' || g.status === 'pending'))
        useAppStore.setState((st) => ({ sessions: { ...st.sessions, [l.missionId]: { env: s.env, sim: { ...s.sim, status: 'complete', outcome: 'suspended', version: s.sim.version + 1 } } } }));
    }
  }
  const tickRate = tickRateFor(speed);
  patch(missionId, { status: 'starting', error: null, frames: 0, tick: 0, trail: link.hikerStart ? [link.hikerStart] : [], tickRate });
  try {
    await socket.open();
    const r = await startStream(link.simID, tickRate);
    patch(missionId, { tickRate: r.tickRate ?? tickRate });
    if (r.status === 'already_running') patch(missionId, { status: 'streaming' });
  } catch (e) {
    patch(missionId, { status: 'error', error: errorText(e) });
    maybeCloseSocket();
  }
}

async function onReset(missionId: string) {
  const link = useEngineLinks.getState().links[missionId];
  if (!link) return;
  const wasLive = link.status === 'streaming' || link.status === 'starting';
  patch(missionId, { status: 'ready', tick: 0, frames: 0, hikerCurrent: link.hikerStart, trail: link.hikerStart ? [link.hikerStart] : [], error: null });
  engineEnded.delete(missionId);
  // Hidden truth back to the engine's start position.
  const sess = useAppStore.getState().sessions[missionId];
  if (sess && link.hikerStart) useAppStore.setState((st) => ({ sessions: { ...st.sessions, [missionId]: { env: sess.env, sim: { ...sess.sim, hiker: link.hikerStart!, version: sess.sim.version + 1 } } } }));
  if (wasLive) {
    try {
      await stopStream();
    } catch (e) {
      patch(missionId, { error: errorText(e) });
    }
    maybeCloseSocket();
  }
}

engineHandlers.start = (id, speed) => void launch(id, speed);
engineHandlers.reset = (id) => void onReset(id);

/** Stop the engine stream for this search (DELETE /api/sim/stream). */
export async function stopEngineSearch(missionId: string) {
  try {
    await stopStream();
  } catch (e) {
    patch(missionId, { error: errorText(e) });
  }
  // A "stopped" frame normally arrives; mark it locally too in case the socket is gone.
  window.setTimeout(() => {
    const l = useEngineLinks.getState().links[missionId];
    if (l && (l.status === 'streaming' || l.status === 'starting')) {
      patch(missionId, { status: 'stopped' });
      engineEnded.add(missionId);
      maybeCloseSocket();
    }
  }, 1500);
}
