/**
 * Centralized application state. Pages read from here; all simulation mutation goes through
 * the services so every panel sees the same SimState version (no contradictory views).
 */
import { create } from 'zustand';
import type { FleetDrone } from '../types/drone';
import type { HistoricalMission, MissingPersonReport, Mission, MissionStatus } from '../types/mission';
import type { FieldReport, MissionEnvironment, SimEvent, SimState } from '../types/simulation';
import { MOCK_REPORTS } from '../data/mockReports';
import { MOCK_MISSIONS } from '../data/mockMissions';
import { MOCK_FLEET } from '../data/mockDrones';
import { MOCK_HISTORY } from '../data/mockHistory';
import { MOCK_ACTIVITY, type ActivityItem, type ActivityKind } from '../data/mockActivity';
import { parkById } from '../data/mockParks';
import { createEnvironment } from '../services/missionService';
import { TICK_SEC, confirmSignal, createSimulation, dismissSignal, dispatchGroundTeam, standDown, stepSimulation, tickGroundTeamOnly, warmUp } from '../services/simulationService';
import { engineDriven, engineEnded, engineHandlers } from '../api/engineRegistry';
import { availableDrones } from '../services/droneService';
import { playDetectionAlert } from '../services/audioService';
import { tickTiming } from '../hooks/tickTiming';

export interface Session {
  env: MissionEnvironment;
  sim: SimState;
}

export interface AlertItem {
  id: string;
  at: number;
  missionId: string;
  severity: SimEvent['severity'];
  kind: SimEvent['kind'] | 'system';
  title: string;
  message: string;
  x?: number;
  y?: number;
  signalId?: string;
  read: boolean;
}

export interface Settings {
  /** Chime + spoken line when a drone reports a potential human detection. */
  sound: boolean;
  defaultSpeed: number;
  heatmapOpacity: number;
  rangerName: string;
}

export interface FocusRequest {
  missionId: string;
  x: number;
  y: number;
  zoom: number;
  nonce: number;
}

interface AppState {
  reports: MissingPersonReport[];
  missions: Mission[];
  fleet: FleetDrone[];
  history: HistoricalMission[];
  activity: ActivityItem[];
  alerts: AlertItem[];
  toasts: string[];
  sessions: Record<string, Session>;
  currentMissionId: string | null;
  settings: Settings;
  focusRequest: FocusRequest | null;

  ensureSession: (missionId: string) => Session | null;
  registerMission: (mission: Mission, env: MissionEnvironment, sim: SimState) => void;
  setCurrentMission: (id: string | null) => void;
  start: (id: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  reset: (id: string) => void;
  setSpeed: (id: string, speed: number) => void;
  advance: (id: string, intervalMs: number) => void;
  /** Commit a new SimState for a mission and raise alerts, activity and sound for its events. */
  ingest: (id: string, sim: SimState) => void;
  dispatchGroundTeam: (id: string, signalId: string) => void;
  dismissSignal: (id: string, signalId: string) => void;
  /** Ground team's on-scene verdict for a signal (Ground Team view). */
  confirmSignal: (id: string, signalId: string, report: Omit<FieldReport, 'tick' | 'clock'>) => void;
  standDown: (id: string) => void;
  markAlertRead: (alertId: string) => void;
  markAllRead: () => void;
  clearAlerts: () => void;
  dismissToast: (alertId: string) => void;
  focusMap: (missionId: string, x: number, y: number, zoom?: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  getAvailableDrones: () => FleetDrone[];
}

let alertSeq = 0;
let actSeq = 0;

function buildSession(mission: Mission, reports: MissingPersonReport[], fleet: FleetDrone[], hoursOverride?: number, clockBase = mission.createdAt): Session {
  const report = reports.find((r) => r.id === mission.reportId)!;
  const env = createEnvironment(mission, report, parkById(report.parkId), hoursOverride);
  const drones = fleet.filter((f) => mission.dronesAssigned.includes(f.id));
  const sim = createSimulation(env, mission, drones, clockBase);
  return { env, sim };
}

/**
 * Pre-existing missions are replayed headlessly up to their recorded progress. The replay is
 * calibrated so that, once it finishes, "time missing" and the sim clock line up with the report
 * (i.e. the replayed search happened *before* now, not after it).
 */
function buildReplayedSession(mission: Mission, reports: MissingPersonReport[], fleet: FleetDrone[]): Session {
  const report = reports.find((r) => r.id === mission.reportId)!;
  const probe = buildSession(mission, reports, fleet);
  const probeRun = warmUp(probe.sim, probe.env, mission.progress, 420);
  const replayH = Math.min(probeRun.elapsedSec / 3600, report.hoursMissing - 0.35);
  const startHours = report.hoursMissing - replayH;
  const sess = buildSession(mission, reports, fleet, startHours, Date.now() - replayH * 3600_000);
  sess.sim = warmUp(sess.sim, sess.env, 2, Math.round((replayH * 3600) / TICK_SEC));
  return sess;
}

const TOAST_KINDS = new Set<AlertItem['kind']>(['detection', 'located', 'ground_on_scene']);
const ALERT_KINDS = new Set(['detection', 'ground_on_scene', 'low_battery', 'sector_complete', 'priority', 'located', 'false_positive', 'mission_complete']);

function activityKind(e: SimEvent): ActivityKind {
  switch (e.kind) {
    case 'launch':
      return 'deploy';
    case 'detection':
    case 'located':
    case 'false_positive':
      return 'detection';
    case 'low_battery':
    case 'priority':
      return 'warning';
    case 'ground_on_scene':
      return 'ranger';
    default:
      return 'system';
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  reports: MOCK_REPORTS,
  missions: MOCK_MISSIONS,
  fleet: MOCK_FLEET,
  history: MOCK_HISTORY,
  activity: MOCK_ACTIVITY,
  alerts: [],
  toasts: [],
  sessions: {},
  currentMissionId: null,
  settings: {
    sound: true,
    defaultSpeed: 2,
    heatmapOpacity: 0.7,
    rangerName: 'J. Alvarez',
  },
  focusRequest: null,

  ensureSession: (missionId) => {
    const existing = get().sessions[missionId];
    if (existing) return existing;
    const mission = get().missions.find((m) => m.id === missionId);
    if (!mission) return null;
    const replay = mission.status !== 'initializing' && mission.status !== 'ready' && mission.progress > 0;
    const sess = replay ? buildReplayedSession(mission, get().reports, get().fleet) : buildSession(mission, get().reports, get().fleet, undefined, Date.now());
    // A search is either not started or actively searching — never paused. Missions already in
    // the field keep searching in real time (1×) in the background.
    if (replay) sess.sim = { ...sess.sim, status: 'running', speed: 1 };
    else sess.sim.speed = get().settings.defaultSpeed;
    set((st) => ({ sessions: { ...st.sessions, [missionId]: sess } }));
    return sess;
  },

  registerMission: (mission, env, sim) => {
    sim.speed = get().settings.defaultSpeed;
    set((st) => ({
      missions: [mission, ...st.missions],
      sessions: { ...st.sessions, [mission.id]: { env, sim } },
      reports: st.reports.map((r) => (r.id === mission.reportId ? { ...r, status: 'active', missionId: mission.id } : r)),
      currentMissionId: mission.id,
      activity: [
        { id: `act-${++actSeq}`, at: Date.now(), missionId: mission.id, kind: 'system' as const, message: `Mission ${mission.id} initialized for ${mission.missingPerson} — ${mission.park}` },
        ...st.activity,
      ].slice(0, 120),
    }));
  },

  setCurrentMission: (id) => set({ currentMissionId: id }),

  start: (id) => {
    // Engine-driven searches start the backend stream; frames then set the sim running.
    if (engineDriven.has(id) && engineHandlers.start) return engineHandlers.start(id, get().sessions[id]?.sim.speed ?? 1);
    updateSim(set, get, id, (s) => ({ ...s, status: 'running', version: s.version + 1 }));
  },
  pause: (id) => updateSim(set, get, id, (s) => (s.status === 'running' ? { ...s, status: 'paused', version: s.version + 1 } : s)),
  resume: (id) => updateSim(set, get, id, (s) => (s.status === 'paused' ? { ...s, status: 'running', version: s.version + 1 } : s)),
  setSpeed: (id, speed) => updateSim(set, get, id, (s) => ({ ...s, speed, version: s.version + 1 })),
  reset: (id) => {
    const sess = get().sessions[id];
    const mission = get().missions.find((m) => m.id === id);
    if (!sess || !mission) return;
    const drones = get().fleet.filter((f) => mission.dronesAssigned.includes(f.id));
    const sim = createSimulation(sess.env, mission, drones, sess.sim.clockBase);
    sim.speed = sess.sim.speed;
    set((st) => ({ sessions: { ...st.sessions, [id]: { env: sess.env, sim } } }));
    if (engineDriven.has(id)) engineHandlers.reset?.(id);
  },

  advance: (id, intervalMs) => {
    const sess = get().sessions[id];
    if (!sess || sess.sim.status !== 'running') return;
    if (engineDriven.has(id)) {
      // The engine owns the clock; once it has stopped, only ground-team travel advances here.
      if (!engineEnded.has(id)) return;
      return get().ingest(id, tickGroundTeamOnly(sess.sim, sess.env));
    }
    const sim = stepSimulation(sess.sim, sess.env, { detection: true });
    tickTiming.last = performance.now();
    tickTiming.interval = intervalMs;
    get().ingest(id, sim);
  },

  ingest: (id, sim) => {
    const sess = get().sessions[id];
    if (!sess || sim === sess.sim) return;
    const events = sim.events;
    const settings = get().settings;
    const newAlerts: AlertItem[] = [];
    const newActivity: ActivityItem[] = [];
    const now = Date.now();
    // Possible-sighting alerts (popup, bell entry, sound) only for the search open on the search map.
    // Other searches still show the sighting as "Possible sighting" in the sidebar and Overview.
    const seg = typeof window !== 'undefined' ? window.location.pathname.split('/') : [];
    const viewing = seg[1] === 'map' && seg[2] === id;
    for (const e of events) {
      if (ALERT_KINDS.has(e.kind) && (e.kind !== 'detection' || viewing)) {
        newAlerts.push({ id: `al-${++alertSeq}`, at: now, missionId: id, severity: e.severity, kind: e.kind, title: e.title, message: e.message, x: e.x, y: e.y, signalId: e.signalId, read: false });
      }
      newActivity.push({ id: `act-${++actSeq}`, at: now, missionId: id, kind: activityKind(e), message: e.message });
    }
    if (sim.tick % 15 === 0) {
      newActivity.push({
        id: `act-${++actSeq}`,
        at: now,
        missionId: id,
        kind: 'probability',
        message: `Probability updated — unexplored mass ${(sim.stats.unexploredMass * 100).toFixed(1)}%, coverage ${(sim.stats.coverage * 100).toFixed(0)}%`,
      });
    }
    const lastAuction = sim.auctions[sim.auctions.length - 1];
    if (sim.tick % 6 === 0 && lastAuction?.winnerId && lastAuction.tick === sim.tick) {
      newActivity.push({ id: `act-${++actSeq}`, at: now, missionId: id, kind: 'assignment', message: `${lastAuction.winnerId} won auction for cell ${lastAuction.blockId}` });
    }
    set((st) => ({
      sessions: { ...st.sessions, [id]: { env: sess.env, sim } },
      alerts: newAlerts.length ? [...newAlerts.reverse(), ...st.alerts].slice(0, 100) : st.alerts,
      // Only search-critical events pop up; everything else waits in the notification center.
      toasts: newAlerts.some((a) => TOAST_KINDS.has(a.kind)) ? [...st.toasts, ...newAlerts.filter((a) => TOAST_KINDS.has(a.kind)).map((a) => a.id)].slice(-3) : st.toasts,
      activity: newActivity.length ? [...newActivity.reverse(), ...st.activity].slice(0, 120) : st.activity,
    }));
    // Audio: only a potential human detection makes a sound.
    const detection = events.find((e) => e.kind === 'detection');
    if (detection && viewing && settings.sound) playDetectionAlert(detection.voice ?? 'Potential human detected.');
  },

  dispatchGroundTeam: (id, signalId) => {
    const sess = get().sessions[id];
    if (!sess) return;
    const sim = dispatchGroundTeam(sess.sim, sess.env, signalId);
    if (engineDriven.has(id)) engineHandlers.signal?.(id, signalId, 'dispatch');
    const status = sim.status === 'paused' ? 'running' : sim.status;
    set((st) => ({
      sessions: { ...st.sessions, [id]: { env: sess.env, sim: { ...sim, status } } },
      activity: [{ id: `act-${++actSeq}`, at: Date.now(), missionId: id, kind: 'ranger' as const, message: `Ranger ${st.settings.rangerName} dispatched ground team to verify ${signalId}` }, ...st.activity].slice(0, 120),
    }));
  },

  confirmSignal: (id, signalId, report) => {
    const sess = get().sessions[id];
    if (!sess) return;
    const prevStatus = sess.sim.status;
    let sim = confirmSignal(sess.sim, sess.env, signalId, report);
    if (sim === sess.sim) return;
    if (engineDriven.has(id)) engineHandlers.signal?.(id, signalId, report.verdict === 'subject' ? 'confirmed' : report.verdict === 'other_person' ? 'not_subject' : 'false_positive');
    // A cleared signal resumes a paused search; a confirmed subject completes the mission.
    if (sim.status === 'paused' && prevStatus === 'paused' && report.verdict !== 'subject') sim = { ...sim, status: 'running' };
    const now = Date.now();
    const alerts: AlertItem[] = sim.events.map((e) => ({ id: `al-${++alertSeq}`, at: now, missionId: id, severity: e.severity, kind: e.kind, title: e.title, message: e.message, x: e.x, y: e.y, signalId: e.signalId, read: false }));
    const verdictText = report.verdict === 'subject' ? `confirmed ${sess.env.report.name} located` : report.verdict === 'other_person' ? 'found a different person, not the subject' : 'found no person (animal or heat source)';
    set((st) => ({
      sessions: { ...st.sessions, [id]: { env: sess.env, sim } },
      alerts: [...alerts.reverse(), ...st.alerts].slice(0, 100),
      // Retire this signal's earlier pop-ups (detection, team on scene) now that it is resolved.
      toasts: [
        ...st.toasts.filter((tid) => {
          const a = st.alerts.find((x) => x.id === tid);
          return !(a && a.missionId === id && a.signalId === signalId);
        }),
        ...alerts.filter((a) => TOAST_KINDS.has(a.kind)).map((a) => a.id),
      ].slice(-3),
      activity: [{ id: `act-${++actSeq}`, at: now, missionId: id, kind: 'ranger' as const, message: `Ground team at ${signalId} ${verdictText}` }, ...st.activity].slice(0, 120),
    }));
  },

  dismissSignal: (id, signalId) => {
    const sess = get().sessions[id];
    if (!sess) return;
    const sim = dismissSignal(sess.sim, signalId);
    if (engineDriven.has(id)) engineHandlers.signal?.(id, signalId, 'dismiss');
    const status = sim.status === 'paused' ? 'running' : sim.status;
    set((st) => ({
      sessions: { ...st.sessions, [id]: { env: sess.env, sim: { ...sim, status } } },
      activity: [{ id: `act-${++actSeq}`, at: Date.now(), missionId: id, kind: 'ranger' as const, message: `Ranger ${st.settings.rangerName} dismissed ${signalId} as non-subject` }, ...st.activity].slice(0, 120),
    }));
  },

  standDown: (id) => {
    const sess = get().sessions[id];
    if (!sess) return;
    const sim = standDown(sess.sim, sess.env);
    if (engineDriven.has(id)) engineHandlers.standDown?.(id);
    set((st) => ({
      sessions: { ...st.sessions, [id]: { env: sess.env, sim } },
      activity: [{ id: `act-${++actSeq}`, at: Date.now(), missionId: id, kind: 'ranger' as const, message: `Mission ${id} stood down — drones released to fleet` }, ...st.activity].slice(0, 120),
    }));
  },

  markAlertRead: (alertId) => set((st) => ({ alerts: st.alerts.map((a) => (a.id === alertId ? { ...a, read: true } : a)) })),
  markAllRead: () => set((st) => ({ alerts: st.alerts.map((a) => ({ ...a, read: true })) })),
  clearAlerts: () => set({ alerts: [], toasts: [] }),
  dismissToast: (alertId) => set((st) => ({ toasts: st.toasts.filter((t) => t !== alertId) })),
  focusMap: (missionId, x, y, zoom = 9) => set({ focusRequest: { missionId, x, y, zoom, nonce: Date.now() + Math.random() } }),
  updateSettings: (patch) => set((st) => ({ settings: { ...st.settings, ...patch } })),
  getAvailableDrones: () => availableDrones(get().fleet, get().missions, get().sessions),
}));

function updateSim(set: (fn: (st: AppState) => Partial<AppState>) => void, get: () => AppState, id: string, fn: (s: SimState) => SimState) {
  const sess = get().sessions[id];
  if (!sess) return;
  const sim = fn(sess.sim);
  if (sim === sess.sim) return;
  set((st) => ({ sessions: { ...st.sessions, [id]: { env: sess.env, sim } } }));
}

/** Derived, display-level mission status combining the mission record with live sim state. */
export function missionStatus(m: Mission, sess?: Session): MissionStatus {
  if (!sess) return m.status;
  const s = sess.sim;
  if (s.outcome === 'located') return 'located';
  if (s.outcome === 'stood_down') return 'stood_down';
  if (s.outcome === 'suspended') return 'suspended';
  if (s.signals.some((x) => x.status === 'pending')) return 'detection';
  if (s.signals.some((x) => x.status === 'verifying' || x.status === 'on_scene')) return 'verifying';
  if (s.status === 'ready') return m.status === 'initializing' ? 'initializing' : 'ready';
  if (s.status === 'paused') return 'paused';
  return m.priority === 'critical' ? 'high_priority' : 'active';
}

export function missionProgress(m: Mission, sess?: Session): number {
  return sess ? sess.sim.stats.coverage : m.progress;
}

export function missionHoursMissing(m: Mission, sess?: Session, reports?: MissingPersonReport[]): number {
  if (sess) return sess.env.hoursMissingAtStart + sess.sim.elapsedSec / 3600;
  const r = reports?.find((x) => x.id === m.reportId);
  return r?.hoursMissing ?? 0;
}
