import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Check, Loader2 } from 'lucide-react';
import type { MissingPersonReport, Mission } from '../../types/mission';
import type { TerrainGrid } from '../../types/terrain';
import type { MissionEnvironment, SimState } from '../../types/simulation';
import { parkById } from '../../data/mockParks';
import { getTerrain } from '../../services/terrainService';
import { createEnvironment } from '../../services/missionService';
import { computePrior } from '../../services/probabilityService';
import { createSimulation } from '../../services/simulationService';
import { warmRaster } from '../terrain/rasterizer';
import { useAppStore } from '../../store/appStore';
import { LifelineLogo } from '../ui/icons';
import { formatDuration } from '../../lib/format';

interface Stage {
  label: string;
  detail?: string;
  ms?: number;
}

const LABELS = [
  'Loading park terrain...',
  'Processing elevation data...',
  'Analyzing vegetation coverage...',
  'Calculating estimated hiker movement...',
  'Generating probability distribution...',
  'Initializing drone fleet...',
  'Mission environment ready.',
];

/**
 * Staged mission initialization. Each stage performs the real (mock) work: terrain generation,
 * raster preparation, Tobler travel-time field, prior PDF and fleet/simulation creation.
 */
export default function MissionInitializer({ report, onCancel }: { report: MissingPersonReport; onCancel: () => void }) {
  const navigate = useNavigate();
  const register = useAppStore((s) => s.registerMission);
  const getAvailable = useAppStore((s) => s.getAvailableDrones);
  const missions = useAppStore((s) => s.missions);
  const fleet = useAppStore((s) => s.fleet);
  const [stages, setStages] = useState<Stage[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const park = parkById(report.parkId);
    const nextId = `M-${String(missions.reduce((mx, m) => Math.max(mx, Number(m.id.slice(2)) || 0), 0) + 1).padStart(3, '0')}`;
    const drones = getAvailable().slice(0, 6);
    if (drones.length < 2) {
      setError('Fewer than 2 drones are available. Stand down or complete another mission to free airframes.');
      return;
    }
    const mission: Mission = {
      id: nextId,
      missingPerson: report.name,
      park: park.name,
      parkId: park.id,
      reportId: report.id,
      lastKnownPosition: report.lkp,
      timeLastSeen: new Date(Date.now() - report.hoursMissing * 3600_000).toISOString(),
      status: 'ready',
      priority: report.priority,
      dronesAssigned: drones.map((d) => d.id),
      createdAt: Date.now(),
      progress: 0,
    };
    let grid: TerrainGrid;
    let env: MissionEnvironment;
    let sim: SimState;
    const steps: (() => string)[] = [
      () => {
        grid = getTerrain(park, report.id, report.lkp);
        return `${park.name} · ${grid.width}×${grid.height} cells @ ${grid.cellSizeM} m`;
      },
      () => {
        warmRaster(grid, 'elevation');
        return `${Math.round(grid.minElevation).toLocaleString()}–${Math.round(grid.maxElevation).toLocaleString()} m · hillshade + 50 m contours`;
      },
      () => {
        warmRaster(grid, 'vegetation');
        warmRaster(grid, 'probability');
        const dense = Array.from(grid.vegetation).filter((v) => v >= 3).length / grid.vegetation.length;
        return `${Math.round(dense * 100)}% tree cover · ${grid.trails.length} trails · ${grid.rivers.length} drainages`;
      },
      () => {
        env = createEnvironment(mission, report, park);
        return `Tobler travel field from LKP · ${env.searchAreaCells.toLocaleString()} cells (${(env.searchAreaCells * 0.0036).toFixed(1)} km²) feasible`;
      },
      () => {
        const prior = new Float32Array(env.travelTime.length);
        const tm = computePrior(env.travelTime, env.behavior, env.hoursMissingAtStart, prior, env.mobileScale);
        let mx = 0;
        for (const v of prior) mx = Math.max(mx, v);
        return `Normalized PDF (Σ=1) · ${formatDuration(report.hoursMissing)} elapsed · ${formatDuration(tm)} mobile · peak ${(mx * 100).toFixed(3)}%`;
      },
      () => {
        sim = createSimulation(env, mission, fleet.filter((f) => mission.dronesAssigned.includes(f.id)), mission.createdAt);
        return `${drones.length} drones staged: ${drones.map((d) => d.id).join(', ')}`;
      },
      () => {
        register(mission, env, sim);
        return `Mission ${mission.id} ready for launch`;
      },
    ];
    let i = 0;
    const run = () => {
      if (i >= steps.length) {
        setTimeout(() => navigate(`/map/${mission.id}`), 650);
        return;
      }
      setActive(i);
      setTimeout(() => {
        const t0 = performance.now();
        const detail = steps[i]();
        const ms = performance.now() - t0;
        setStages((s) => [...s, { label: LABELS[i], detail, ms }]);
        i++;
        setTimeout(run, 260 + Math.random() * 220);
      }, 120);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = stages.length / LABELS.length;

  return (
    <div className="fixed inset-0 z-[80] flex animate-fadeIn items-center justify-center bg-panel/95 backdrop-blur-sm">
      <div className="bg-grid absolute inset-0 opacity-40" />
      <div className="relative w-[620px] overflow-hidden rounded-lg border border-line bg-panel shadow-float">
        <div className="relative h-1 overflow-hidden bg-base">
          <div className="h-full bg-gradient-to-r from-accent to-info transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          {progress < 1 && <div className="absolute inset-y-0 w-1/3 animate-scan bg-gradient-to-r from-transparent via-white/30 to-transparent" />}
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <LifelineLogo size={44} />
              {progress < 1 && <span className="absolute -inset-1 animate-pulseRing rounded-lg border border-accent/40" />}
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted">Setting up the search</div>
              <div className="text-[17px] font-semibold text-ink">
                {report.name} · {parkById(report.parkId).shortName}
              </div>
              <div className="font-mono text-[11px] text-muted">{report.id}</div>
            </div>
            <div className="ml-auto font-mono text-2xl font-semibold text-accent">{Math.round(progress * 100)}%</div>
          </div>
          {error ? (
            <div className="mt-5 rounded-lg border border-crit/40 bg-crit/10 p-3 text-[12.5px] text-crit">
              {error}
              <div className="mt-3">
                <button onClick={onCancel} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink">
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-1.5 font-mono text-[12px]">
              {LABELS.map((l, i) => {
                const done = stages[i];
                const isActive = !done && i === active;
                return (
                  <div key={l} className={clsx('flex items-start gap-3 rounded-lg px-3 py-1.5 transition-colors', isActive && 'bg-elevated', !done && !isActive && 'opacity-35')}>
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {done ? <Check size={14} className="text-ok" /> : isActive ? <Loader2 size={14} className="animate-spin text-info" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={done ? 'text-ink' : 'text-muted'}>{l}</span>
                      {done?.detail && <span className="block truncate text-[10.5px] text-muted">{done.detail}</span>}
                    </span>
                    {done?.ms !== undefined && <span className="text-[10px] text-muted/70">{done.ms.toFixed(0)} ms</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 text-[10.5px] text-muted">All stages run locally against procedurally generated mock data — no external services.</div>
        </div>
      </div>
    </div>
  );
}
