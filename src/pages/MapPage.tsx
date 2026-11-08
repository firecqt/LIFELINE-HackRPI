/**
 * Search map — the mission workspace. Full-bleed terrain map with a floating mission card,
 * base-map switcher and legend; the right panel always shows the next step; playback below.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Crosshair, Info, PanelRightOpen, Radar, X } from 'lucide-react';
import TerrainMap, { type MapFocus } from '../components/terrain/TerrainMap';
import TerrainLegend from '../components/terrain/TerrainLegend';
import { cellRows } from '../components/terrain/TerrainTooltip';
import { DEFAULT_OVERLAYS, LayerMenu, ViewModeSwitch } from '../components/terrain/TerrainControls';
import PlaybackBar from '../components/simulation/PlaybackBar';
import AuctionVisualizer from '../components/simulation/AuctionVisualizer';
import MissionPanel from '../components/operations/MissionPanel';
import { Avatar, Badge, ProgressBar, Stepper } from '../components/ui';
import { useMission } from '../hooks/useMission';
import { missionHoursMissing, useAppStore, type Session } from '../store/appStore';
import type { GridPoint, MapOverlays, TerrainViewMode } from '../types/terrain';
import type { MissionEnvironment, SimState } from '../types/simulation';
import type { Mission } from '../types/mission';
import { STATUS_META } from '../services/droneService';
import { cellToLatLon } from '../services/terrainService';
import { TICK_SEC } from '../services/simulationService';
import { PHASE_META, missionPhase } from '../lib/missionPhase';
import { formatDuration, formatLatLon } from '../lib/format';
import { VEGETATION_LABELS } from '../types/terrain';

export default function MapPage() {
  const params = useParams();
  const navigate = useNavigate();
  const currentId = useAppStore((s) => s.currentMissionId);
  const setCurrent = useAppStore((s) => s.setCurrentMission);
  const missions = useAppStore((s) => s.missions);
  const missionId = params.missionId ?? currentId ?? missions[0]?.id ?? null;

  useEffect(() => {
    if (params.missionId && params.missionId !== currentId) setCurrent(params.missionId);
    if (!params.missionId && missionId) navigate(`/map/${missionId}`, { replace: true });
  }, [params.missionId, currentId, missionId, setCurrent, navigate]);

  const { mission, session } = useMission(missionId);
  if (!missionId || !mission) return <div className="p-10 text-sm text-muted">No missions yet. Start one from Missing persons.</div>;
  if (!session)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        <Radar className="mr-2 animate-spin" size={16} /> Loading the search area…
      </div>
    );
  return <Workspace key={mission.id} missionId={mission.id} />;
}

function Workspace({ missionId }: { missionId: string }) {
  const { mission, session } = useMission(missionId);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const focusRequest = useAppStore((s) => s.focusRequest);
  const markRead = useAppStore((s) => s.markAlertRead);
  const alerts = useAppStore((s) => s.alerts);
  const [mode, setMode] = useState<TerrainViewMode>('terrain');
  const [overlays, setOverlays] = useState<MapOverlays>(DEFAULT_OVERLAYS);
  const [selectedCell, setSelectedCell] = useState<GridPoint | null>(null);
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null);
  const [timelineIdx, setTimelineIdx] = useState<number | null>(null);
  const [auctionOpen, setAuctionOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [focus, setFocus] = useState<MapFocus | null>(null);

  const sim = session!.sim;
  const env = session!.env;
  const fitBounds = useMemo(() => {
    const W = env.grid.width;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    env.searchArea.forEach((v, i) => {
      if (!v) return;
      const x = i % W;
      const y = Math.floor(i / W);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    });
    // Extra room on the left for the floating mission card.
    return { x0: x0 - 14, y0: y0 - 5, x1: x1 + 5, y1: y1 + 5 };
  }, [env]);

  const focusOn = useCallback((x: number, y: number, zoom = 4) => setFocus({ x, y, zoom, nonce: Date.now() + Math.random() }), []);

  // External focus requests (alerts, drone list on other pages)
  useEffect(() => {
    if (focusRequest && focusRequest.missionId === missionId) setFocus({ x: focusRequest.x, y: focusRequest.y, zoom: focusRequest.zoom, nonce: focusRequest.nonce });
  }, [focusRequest, missionId]);

  // Mark detection alerts read while looking at this mission
  useEffect(() => {
    alerts.filter((a) => a.missionId === missionId && !a.read && a.kind === 'detection').forEach((a) => markRead(a.id));
  }, [alerts, missionId, markRead]);

  // Fly to a new sighting automatically
  const lastSighting = useRef<string | null>(sim.signals.find((s) => s.status === 'pending')?.id ?? null);
  useEffect(() => {
    const p = sim.signals.find((s) => s.status === 'pending');
    if (p && p.id !== lastSighting.current) {
      lastSighting.current = p.id;
      setTimelineIdx(null);
      focusOn(p.x, p.y, 3.5);
    }
  }, [sim.signals, focusOn]);

  useEffect(() => {
    if (sim.tick === 0) setTimelineIdx(null);
  }, [sim.tick]);

  const distribution = timelineIdx === null ? sim.probability : sim.snapshots[timelineIdx]?.distribution ?? sim.probability;
  if (!mission) return null;
  const drone = selectedDrone ? sim.drones.find((d) => d.id === selectedDrone) : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <TerrainMap
            grid={env.grid}
            env={env}
            sim={sim}
            mode={mode}
            overlays={overlays}
            distribution={distribution}
            heatmapOpacity={settings.heatmapOpacity}
            selectedCell={selectedCell}
            onSelectCell={(c) => {
              setSelectedCell(c);
              if (c) setSelectedDrone(null);
            }}
            selectedDroneId={selectedDrone}
            onSelectDrone={(id) => {
              setSelectedDrone(id);
              if (id) setSelectedCell(null);
            }}
            onSelectSignal={(id) => {
              const s = sim.signals.find((x) => x.id === id);
              if (s) focusOn(s.x, s.y, 6);
            }}
            focus={focus}
            fitBounds={fitBounds}
            showGrid={overlays.grid}
            showMinimap={false}
          >
            <MissionCard mission={mission} session={session!} />

            <div className="absolute left-[324px] top-4 z-20 flex items-center gap-2 rounded-lg border border-line bg-panel/95 p-1 shadow-float backdrop-blur">
              <ViewModeSwitch mode={mode} onChange={setMode} />
              <LayerMenu overlays={overlays} onChange={setOverlays} opacity={settings.heatmapOpacity} onOpacity={(v) => updateSettings({ heatmapOpacity: v })} />
            </div>

            {timelineIdx !== null && (
              <div className="absolute left-1/2 top-[68px] z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-warn px-4 py-1.5 text-[12px] font-medium text-white shadow-float">
                Showing the map as it was {Math.round(sim.snapshots[timelineIdx]?.minutes ?? 0)} min into the search
                <button onClick={() => setTimelineIdx(null)} className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/30">
                  Back to live
                </button>
              </div>
            )}

            {sim.status === 'ready' && (
              <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink/85 px-4 py-2 text-[12.5px] text-white shadow-float">
                Purple shading = where {mission.missingPerson.split(' ')[0]} most likely is. Launch the drones to start searching.
              </div>
            )}

            <div className="absolute bottom-12 left-4 z-10">
              {legendOpen ? (
                <div className="relative">
                  <button onClick={() => setLegendOpen(false)} className="absolute right-2 top-2 z-10 rounded p-0.5 text-muted hover:text-ink" title="Hide legend">
                    <X size={13} />
                  </button>
                  <TerrainLegend mode={mode} grid={env.grid} showProbability={overlays.heatmap} />
                  <MapSymbols />
                </div>
              ) : (
                <button onClick={() => setLegendOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/95 px-3 py-1.5 text-[12px] font-medium text-ink shadow-float">
                  <Info size={13} /> Legend
                </button>
              )}
            </div>

            {!panelOpen && <PanelToggle mission={mission} session={session!} onOpen={() => setPanelOpen(true)} />}
            {selectedCell && <CellPanel x={selectedCell.x} y={selectedCell.y} env={env} sim={sim} distribution={distribution} onClose={() => setSelectedCell(null)} />}
            {drone && <DronePanel droneId={drone.id} sim={sim} env={env} onClose={() => setSelectedDrone(null)} onFocus={() => focusOn(drone.x, drone.y, 5)} />}
          </TerrainMap>
        </div>
        {auctionOpen && <AuctionVisualizer sim={sim} env={env} open onToggle={() => setAuctionOpen(false)} onFocusBlock={(x, y) => focusOn(x, y, 6)} />}
        <PlaybackBar sim={sim} missionId={missionId} index={timelineIdx} onIndex={setTimelineIdx} auctionOpen={auctionOpen} onAuction={() => setAuctionOpen((v) => !v)} />
      </div>
      {panelOpen && (
        <MissionPanel
          onCollapse={() => setPanelOpen(false)}
          mission={mission}
          session={session!}
          onFocus={focusOn}
          selectedDroneId={selectedDrone}
          onFocusDrone={(id) => {
            const d = sim.drones.find((x) => x.id === id);
            setSelectedDrone(id);
            setSelectedCell(null);
            if (d) focusOn(d.x, d.y, 5);
          }}
        />
      )}
    </div>
  );
}

/** Shown on the map while the mission panel is collapsed; turns red when a decision is waiting. */
function PanelToggle({ mission, session, onOpen }: { mission: Mission; session: Session; onOpen: () => void }) {
  const phase = missionPhase(mission, session);
  const meta = PHASE_META[phase];
  const urgent = phase === 'review' || phase === 'on_scene';
  return (
    <button
      onClick={onOpen}
      className={clsx(
        'absolute right-14 top-4 z-20 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12.5px] font-medium shadow-float',
        urgent ? 'border-crit bg-crit text-white' : 'border-line bg-panel text-ink hover:bg-elevated',
      )}
      title="Show mission panel"
    >
      <PanelRightOpen size={15} />
      {urgent ? (
        phase === 'review' ? 'Possible sighting — review' : 'Team on scene — confirm'
      ) : (
        <>
          Show panel
          <span className="flex items-center gap-1.5 border-l border-line pl-2 text-[12px] font-normal text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </span>
        </>
      )}
    </button>
  );
}

function MissionCard({ mission, session }: { mission: Mission; session: Session }) {
  const reports = useAppStore((s) => s.reports);
  const phase = missionPhase(mission, session);
  const r = session.env.report;
  const hours = missionHoursMissing(mission, session, reports);
  const over = hours > r.responseWindowH;
  return (
    <div className="absolute left-4 top-4 z-10 w-[292px] rounded-lg border border-line bg-panel/95 p-4 shadow-float backdrop-blur">
      <div className="flex items-center gap-3">
        <Avatar name={r.name} size={44} color={phase === 'found' ? '#0E9F6E' : '#F26B1D'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold text-ink">{r.name}</div>
          <div className="truncate text-[12px] text-muted">
            {r.age} yrs · {r.experience} · {session.env.park.shortName ?? session.env.park.name}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[12px] text-muted">{phase === 'found' ? 'Was missing for' : 'Missing for'}</span>
        <span className={clsx('text-[18px] font-semibold tabular-nums', over && phase !== 'found' ? 'text-crit' : 'text-ink')}>{formatDuration(hours)}</span>
      </div>
      {phase !== 'found' && <ProgressBar value={hours / r.responseWindowH} color={over ? '#E5364B' : hours / r.responseWindowH > 0.7 ? '#C88A04' : '#0E9F6E'} height={4} className="mt-1" />}
      <div className="mt-4">
        <Stepper step={PHASE_META[phase].step} done={phase === 'found'} />
      </div>
    </div>
  );
}

function MapSymbols() {
  return (
    <div className="mt-2 w-[230px] rounded-lg border border-line bg-panel/95 p-3 text-[11px] text-muted shadow-float backdrop-blur">
      <div className="mb-1.5 font-semibold text-ink">Map symbols</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-hiker" /> Last seen
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-crit" /> Sighting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-3.5 border-t-2 border-dashed border-accent" /> Search area
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-[#5B21B6]" /> Best guess
        </span>
      </div>
    </div>
  );
}

function likelihoodWord(p: number, peak: number) {
  const r = peak > 0 ? p / peak : 0;
  return r > 0.6 ? 'Very high' : r > 0.3 ? 'High' : r > 0.1 ? 'Medium' : r > 0.02 ? 'Low' : 'Very low';
}

function CellPanel({ x, y, env, sim, distribution, onClose }: { x: number; y: number; env: MissionEnvironment; sim: SimState; distribution: Float32Array; onClose: () => void }) {
  const r = cellRows(env.grid, x, y, env, sim, distribution);
  let peak = 0;
  for (let i = 0; i < distribution.length; i++) if (distribution[i] > peak) peak = distribution[i];
  const searched = r.cell.searchStatus === 'searched';
  const rows: [string, string][] = [
    ['Chance they are here', r.inArea ? likelihoodWord(r.cell.probability, peak) : 'Outside search area'],
    ['Searched yet?', !r.inArea ? '—' : searched ? 'Yes' : r.cell.searchStatus === 'assigned' ? `Assigned to ${r.drone?.id ?? 'a drone'}` : 'Not yet'],
    ['Drone spotting chance', `${Math.round(r.pod * 100)}%${r.cell.vegetationDensity > 0.6 ? ' (thick cover)' : ''}`],
    ['Walk from last seen', r.travel !== null && r.travel < Infinity ? formatDuration(r.travel) : '—'],
    ['Ground', r.water ? (r.water === 1 ? 'Open water' : 'River') : VEGETATION_LABELS[r.cell.vegetation]],
    ['Elevation', `${Math.round(r.cell.elevation).toLocaleString()} m`],
    ['Slope', `${r.slope.toFixed(0)}°`],
  ];
  return (
    <div className="absolute right-16 top-4 z-20 w-[272px] animate-slideIn rounded-lg border border-line bg-panel p-4 text-[12px] shadow-float">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13.5px] font-semibold text-ink">This spot{r.sector ? ` · sector ${r.sector}` : ''}</span>
        <button onClick={onClose} className="text-muted hover:text-ink">
          <X size={15} />
        </button>
      </div>
      <div className="mb-3 font-mono text-[11px] text-muted">{formatLatLon(r.ll.latitude, r.ll.longitude, 5)}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-t border-line/70 py-1.5">
          <span className="text-muted">{k}</span>
          <span className="text-right font-medium text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}

function DronePanel({ droneId, sim, env, onClose, onFocus }: { droneId: string; sim: SimState; env: MissionEnvironment; onClose: () => void; onFocus: () => void }) {
  const d = sim.drones.find((x) => x.id === droneId);
  const ll = useMemo(() => (d ? cellToLatLon(env.grid, d.x, d.y) : null), [d, d?.x, d?.y, env.grid]);
  if (!d || !ll) return null;
  const meta = STATUS_META[d.status];
  const speed = d.status === 'searching' ? (d.speedSearch * env.grid.cellSizeM) / TICK_SEC : d.status === 'en_route' || d.status === 'returning' ? (d.speedTransit * env.grid.cellSizeM) / TICK_SEC : 0;
  return (
    <div className="absolute right-16 top-4 z-20 w-[280px] animate-slideIn rounded-lg border border-line bg-panel p-4 text-[12px] shadow-float">
      <div className="mb-1 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
        <span className="text-[15px] font-semibold text-ink">{d.id}</span>
        <Badge color={meta.color}>{meta.label}</Badge>
        <button onClick={onFocus} className="ml-auto text-muted hover:text-ink" title="Center on drone">
          <Crosshair size={15} />
        </button>
        <button onClick={onClose} className="text-muted hover:text-ink">
          <X size={15} />
        </button>
      </div>
      <div className="mb-3 text-[11.5px] text-muted">{d.model}</div>
      <div className="flex items-center gap-2">
        <ProgressBar value={d.battery / 100} color={d.battery < 20 ? '#E5364B' : d.battery < 40 ? '#C88A04' : '#0E9F6E'} height={6} className="flex-1" />
        <span className="font-semibold tabular-nums text-ink">{Math.round(d.battery)}%</span>
      </div>
      <div className="mt-3 rounded-lg bg-base px-3 py-2 text-ink">{d.objective}</div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <T k="Altitude" v={`${Math.round(d.agl)} m above ground`} span />
        <T k="Speed" v={`${speed.toFixed(1)} m/s`} />
        <T k="Flown" v={`${(d.distanceM / 1000).toFixed(1)} km`} />
        <T k="Position" v={formatLatLon(ll.latitude, ll.longitude, 4)} span />
        <T k="Next areas" v={d.assignedCells.length ? d.assignedCells.join(', ') : 'none'} span />
      </div>
    </div>
  );
}

function T({ k, v, span }: { k: string; v: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <div className="text-[11px] text-muted">{k}</div>
      <div className="text-ink">{v}</div>
    </div>
  );
}
