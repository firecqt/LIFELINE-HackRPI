/**
 * Recovery map — shown once the ground team confirms the subject. Plots the last known position,
 * where the subject was found, and a reconstructed travel corridor between the two.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, Check, CheckCircle2, Footprints, Route } from 'lucide-react';
import TerrainMap from '../components/terrain/TerrainMap';
import { ViewModeSwitch } from '../components/terrain/TerrainControls';
import { DEFAULT_OVERLAYS } from '../components/terrain/TerrainControls';
import { Avatar, SectionLabel, SimulatedTag } from '../components/ui';
import { useMission } from '../hooks/useMission';
import { computeRecoveryCorridor } from '../services/probabilityService';
import { CONDITION_LABELS, GROUND_TEAM } from '../services/groundTeamService';
import { cellToLatLon } from '../services/terrainService';
import { TICK_SEC } from '../services/simulationService';
import { PROBABILITY_STOPS, rampCss } from '../lib/colors';
import { PRIORITY_META } from '../lib/statusMeta';
import { formatDuration, formatLatLon } from '../lib/format';
import type { MapOverlays, TerrainViewMode } from '../types/terrain';

export default function Recovery() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const { mission, session } = useMission(missionId ?? null);
  const found = session?.sim.signals.find((s) => s.status === 'confirmed') ?? null;

  if (!mission || !session) return <div className="p-10 text-sm text-muted">Loading mission…</div>;
  if (!found)
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center">
        <h2 className="text-lg font-semibold text-ink">{mission.missingPerson} has not been confirmed found yet</h2>
        <p className="mt-1 text-[13px] text-muted">The recovery map becomes available after the ground team confirms the subject.</p>
        <button onClick={() => navigate(`/map/${mission.id}`)} className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white">
          Back to the search map
        </button>
      </div>
    );
  return <RecoveryView missionId={mission.id} />;
}

function RecoveryView({ missionId }: { missionId: string }) {
  const navigate = useNavigate();
  const { mission, session } = useMission(missionId);
  const { env, sim } = session!;
  const sig = sim.signals.find((s) => s.status === 'confirmed')!;
  const r = env.report;
  const g = env.grid;
  const W = g.width;
  const [mode, setMode] = useState<TerrainViewMode>('terrain');
  const [show, setShow] = useState({ corridor: true, route: true, searchArea: false });

  const foundCell = { x: Math.min(W - 1, Math.floor(sig.x)), y: Math.min(g.height - 1, Math.floor(sig.y)) };
  const corridor = useMemo(() => computeRecoveryCorridor(g, env.travelTime, env.lkp, foundCell, r.hikingSpeedKmh), [env, foundCell.x, foundCell.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitBounds = useMemo(() => {
    let mx = 0;
    for (let i = 0; i < corridor.distribution.length; i++) mx = Math.max(mx, corridor.distribution[i]);
    let x0 = Math.min(env.lkp.x, foundCell.x);
    let x1 = Math.max(env.lkp.x, foundCell.x) + 1;
    let y0 = Math.min(env.lkp.y, foundCell.y);
    let y1 = Math.max(env.lkp.y, foundCell.y) + 1;
    corridor.distribution.forEach((v, i) => {
      if (v < mx * 0.08) return;
      const x = i % W;
      const y = (i / W) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
    });
    // Keep at least ~2.5 km of context around a short walk so terrain does not look blocky.
    const minSpan = Math.ceil(2500 / g.cellSizeM);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const hw = Math.max((x1 - x0) / 2 + 8, minSpan / 2);
    const hh = Math.max((y1 - y0) / 2 + 8, minSpan / 2 / 1.6);
    return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  }, [corridor]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlays: MapOverlays = {
    ...DEFAULT_OVERLAYS,
    lkp: true,
    estimatedLocation: false,
    drones: false,
    flightPaths: false,
    droneBoundaries: false,
    heatmap: show.corridor,
    searchArea: show.searchArea,
    travelRange: false,
    ownership: false,
    trails: true,
    grid: false,
  };

  // Summary numbers
  const fi = foundCell.y * W + foundCell.x;
  const li = env.lkp.y * W + env.lkp.x;
  const fr = sig.fieldReport;
  const confirmTick = fr?.tick ?? sim.tick;
  const hoursMissing = env.hoursMissingAtStart + (confirmTick * TICK_SEC) / 3600;
  const straightKm = (Math.hypot(sig.x - (env.lkp.x + 0.5), sig.y - (env.lkp.y + 0.5)) * g.cellSizeM) / 1000;
  const elevDelta = g.elevation[fi] - g.elevation[li];
  const searchMin = (sig.tick * TICK_SEC) / 60;
  const confirmMin = (confirmTick * TICK_SEC) / 60;
  const foundLL = cellToLatLon(g, sig.x, sig.y);
  // Where the found spot sat in the initial probability map: share of prior mass in likelier cells.
  const rankPct = useMemo(() => {
    const p0 = sim.prior[fi];
    let above = 0;
    for (let i = 0; i < sim.prior.length; i++) if (sim.prior[i] > p0) above += sim.prior[i];
    return above;
  }, [sim.prior, fi]);
  const pr = PRIORITY_META[r.priority];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-base2 px-4 py-2">
          <button onClick={() => navigate(`/map/${missionId}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] text-muted hover:text-ink">
            <ArrowLeft size={14} /> Search map
          </button>
          <div className="mx-1 h-6 w-px bg-line" />
          <ViewModeSwitch mode={mode} onChange={setMode} />
          <div className="mx-1 h-6 w-px bg-line" />
          {(
            [
              ['corridor', 'Likely travel corridor'],
              ['route', 'Fastest route'],
              ['searchArea', 'Original search area'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setShow((v) => ({ ...v, [k]: !v[k] }))}
              className={clsx('rounded-lg border px-2.5 py-1.5 text-[12px] font-medium', show[k] ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-panel text-muted hover:text-ink')}
            >
              {label}
            </button>
          ))}
          <SimulatedTag className="ml-auto" />
        </div>
        <div className="relative min-h-0 flex-1">
          <TerrainMap
            grid={g}
            env={env}
            mode={mode}
            overlays={overlays}
            distribution={corridor.distribution}
            heatmapOpacity={0.75}
            fitBounds={fitBounds}
            showGrid={false}
            showMinimap={false}
            routes={show.route ? [{ points: corridor.route, color: '#101828', width: 2.5, dashed: true }] : []}
            foundMarkers={[{ x: sig.x, y: sig.y, title: 'FOUND', sub: `${r.name} · ${fr?.clock ?? sig.clock}` }]}
          >
            <div className="absolute bottom-12 left-3 z-10 w-[250px] rounded-lg border border-line bg-panel/95 p-3 text-[11px] shadow-float">
              <div className="mb-2 font-semibold text-ink">Legend</div>
              <div className="space-y-1.5 text-muted">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-hiker" /> Last known position
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-ok" /> Where {r.name.split(' ')[0]} was found
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 border-t-2 border-dashed border-ink" /> Fastest walking route
                </div>
                <div>
                  <div className="mb-1 mt-2">Likely travel corridor</div>
                  <div className="h-2 rounded-full" style={{ background: rampCss(PROBABILITY_STOPS) }} />
                  <div className="mt-0.5 flex justify-between text-[10px]">
                    <span>less likely</span>
                    <span>more likely</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 border-t border-line pt-2 text-[10px] leading-snug text-muted">
                Shading shows how likely each spot was on the way from the last known position to the find, based on walking time over the terrain.
              </div>
            </div>
          </TerrainMap>
        </div>
      </div>

      <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
        <div className="border-b border-line bg-ok/5 p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ok">
            <CheckCircle2 size={16} /> Subject located · confirmed by ground team
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Avatar name={r.name} size={48} color={pr.color} />
            <div>
              <div className="text-[17px] font-semibold text-ink">{r.name}</div>
              <div className="text-[12px] text-muted">
                {mission!.id} · {env.park.name}
              </div>
            </div>
          </div>
          {fr?.condition && (
            <div className={clsx('mt-3 rounded-lg px-3 py-2 text-[12.5px] font-medium', fr.condition === 'needs_evacuation' ? 'bg-crit/10 text-crit' : 'bg-ok/10 text-ok')}>{CONDITION_LABELS[fr.condition]}</div>
          )}
        </div>

        <div className="space-y-5 p-4">
          <div>
            <SectionLabel>Where</SectionLabel>
            <Row k="Last known position" v={formatLatLon(env.report.lkp.latitude, env.report.lkp.longitude)} mono />
            <Row k="Found at" v={formatLatLon(foundLL.latitude, foundLL.longitude)} mono />
            <Row k="Straight-line distance" v={`${straightKm.toFixed(2)} km`} />
            <Row k="Elevation change" v={`${elevDelta >= 0 ? '+' : ''}${Math.round(elevDelta)} m (${elevDelta < 0 ? 'downhill' : 'uphill'})`} />
          </div>

          <div>
            <SectionLabel>Likely travel</SectionLabel>
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-base p-3 text-[12px] text-ink">
              <Route size={15} className="mt-0.5 shrink-0 text-accent" />
              The fastest walking route is {corridor.routeKm.toFixed(1)} km, about {formatDuration(corridor.routeHours)} at {r.name.split(' ')[0]}'s estimated pace of {r.hikingSpeedKmh} km/h.
            </div>
            <Row k="Time missing when found" v={formatDuration(hoursMissing)} />
            <Row k="Initial model ranking of this spot" v={`top ${Math.max(1, Math.round(rankPct * 100))}%`} />
          </div>

          <div>
            <SectionLabel>Search</SectionLabel>
            <Row k="Detected by" v={`${sig.droneId} after ${Math.round(searchMin)} min`} />
            <Row k="Confirmed on scene" v={`${Math.round(confirmMin)} min into the search`} />
            <Row k="Drones used" v={`${sim.drones.length}`} />
            <Row k="Area covered" v={`${Math.round(sim.stats.coverage * 100)}% of search area`} />
            <Row k="Drone distance flown" v={`${sim.stats.distanceKm.toFixed(1)} km`} />
          </div>

          {fr && (
            <div>
              <SectionLabel>Ground team report</SectionLabel>
              <div className="rounded-lg bg-base p-3 text-[12px] text-ink">
                <div className="flex items-center gap-1.5 font-medium">
                  <Footprints size={13} className="text-ok" /> {GROUND_TEAM.callsign} · {fr.clock}
                </div>
                <ul className="mt-1.5 space-y-0.5 text-muted">
                  {fr.checks.map((c) => (
                    <li key={c} className="flex items-center gap-1.5">
                      <Check size={12} className="text-ok" /> {c}
                    </li>
                  ))}
                </ul>
                {fr.notes && <div className="mt-1.5 italic">“{fr.notes}”</div>}
              </div>
            </div>
          )}
          <div className="text-[10.5px] leading-snug text-muted">The travel corridor is a model reconstruction (Tobler walking time), not a GPS track. Simulated data.</div>
        </div>
      </aside>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[12.5px]">
      <span className="text-muted">{k}</span>
      <span className={clsx('text-right text-ink', mono && 'font-mono text-[12px]')}>{v}</span>
    </div>
  );
}
