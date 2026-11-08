/**
 * MissionPanel — the right-hand panel of the search map. Top to bottom:
 *   1. "Next step" card: the one action that moves this search forward (launch, review a
 *      sighting, send/track the ground team, view the recovery).
 *   2. Search progress in plain language.
 *   3. Tabs: drones, activity log, case details.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, ClipboardCheck, PanelRightClose, Crosshair, Footprints, Map as MapIcon, Power, Radar, Rocket, X } from 'lucide-react';
import type { Mission } from '../../types/mission';
import type { DetectionSignal, LogType, MissionEnvironment, SimState } from '../../types/simulation';
import { Badge, KV, ProgressBar, Tabs } from '../ui';
import { DroneIcon } from '../ui/icons';
import ThermalFrame from './ThermalFrame';
import { useAppStore, type Session } from '../../store/appStore';
import { PHASE_META, activeSignal, missionPhase, teamEtaMinutes } from '../../lib/missionPhase';
import { SIGNAL_STATUS_META } from '../../lib/statusMeta';
import { STATUS_META } from '../../services/droneService';
import { cellToLatLon } from '../../services/terrainService';
import { BLOCK } from '../../services/missionService';
import { formatElapsed, formatLatLon } from '../../lib/format';
import { engineDriven } from '../../api/engineRegistry';

type Tab = 'drones' | 'activity' | 'details';

const LOG_COLORS: Record<LogType, string> = {
  system: '#94A3B8',
  drone: '#2556E8',
  auction: '#475569',
  search: '#0891B2',
  probability: '#7C3AED',
  detection: '#E5364B',
  warning: '#C88A04',
  ranger: '#0E9F6E',
};

export default function MissionPanel({
  mission,
  session,
  onFocus,
  onFocusDrone,
  selectedDroneId,
  onCollapse,
}: {
  onCollapse: () => void;
  mission: Mission;
  session: Session;
  onFocus: (x: number, y: number, zoom?: number) => void;
  onFocusDrone: (id: string) => void;
  selectedDroneId: string | null;
}) {
  const [tab, setTab] = useState<Tab>('drones');
  const { sim, env } = session;
  const phase = missionPhase(mission, session);
  const meta = PHASE_META[phase];

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Badge color={meta.color} pulse={meta.pulse}>
          {meta.label}
        </Badge>
        <span className="ml-auto font-mono text-[11px] text-muted">{mission.id}</span>
        <button onClick={onCollapse} className="rounded p-1 text-muted hover:bg-elevated hover:text-ink" title="Hide panel to see more of the map">
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <NextStep mission={mission} session={session} onFocus={onFocus} />
          <Progress sim={sim} env={env} onFocus={onFocus} />
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'drones', label: `Drones (${sim.drones.length})`, icon: <DroneIcon size={13} /> },
            { value: 'activity', label: 'Activity' },
            { value: 'details', label: 'Case details' },
          ]}
        />
        {tab === 'drones' && <DroneList sim={sim} onFocusDrone={onFocusDrone} selectedDroneId={selectedDroneId} />}
        {tab === 'activity' && <ActivityLog sim={sim} />}
        {tab === 'details' && <Details mission={mission} session={session} onFocus={onFocus} />}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------------------------
function NextStep({ mission, session, onFocus }: { mission: Mission; session: Session; onFocus: (x: number, y: number, zoom?: number) => void }) {
  const navigate = useNavigate();
  const start = useAppStore((s) => s.start);
  const dispatch = useAppStore((s) => s.dispatchGroundTeam);
  const dismiss = useAppStore((s) => s.dismissSignal);
  const { sim, env } = session;
  const phase = missionPhase(mission, session);
  const sig = activeSignal(session);
  const first = env.report.name.split(' ')[0];
  const id = mission.id;

  if (phase === 'review' && sig) return <SightingCard sig={sig} sim={sim} env={env} first={first} onFocus={onFocus} onDispatch={() => dispatch(id, sig.id)} onDismiss={() => dismiss(id, sig.id)} />;

  if ((phase === 'en_route' || phase === 'on_scene') && sig) {
    const onScene = phase === 'on_scene';
    const total = Math.max(1, (sig.etaTick ?? sim.tick) - (sig.dispatchTick ?? sim.tick));
    const left = Math.max(0, (sig.etaTick ?? sim.tick) - sim.tick);
    return (
      <Card tone={onScene ? 'crit' : 'warn'} icon={<Footprints size={18} />} kicker="Next step" title={onScene ? 'Ground team is on scene' : 'Ground team on the way'}>
        <p className="text-[12.5px] text-ink/80">{onScene ? `They reached the sighting. Confirm whether it is ${first}.` : `About ${teamEtaMinutes(session, sig)} min out. Drones keep searching in the meantime.`}</p>
        {!onScene && <ProgressBar value={1 - left / total} color="#C88A04" height={6} className="mt-3" />}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => navigate(`/ground?mission=${id}&signal=${sig.id}`)}
            className={clsx('inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-white', onScene ? 'bg-crit' : 'bg-ink')}
          >
            <ClipboardCheck size={15} /> {onScene ? 'Confirm on scene' : 'Open ground team view'}
          </button>
          <button onClick={() => onFocus(sig.x, sig.y, 6)} className="rounded-lg border border-line px-3 py-2 text-muted hover:text-ink" title="Show on map">
            <Crosshair size={15} />
          </button>
        </div>
      </Card>
    );
  }

  if (phase === 'found') {
    const f = sim.signals.find((x) => x.status === 'confirmed');
    return (
      <Card tone="ok" icon={<CheckCircle2 size={18} />} kicker="Search complete" title={`${first} has been found`}>
        <p className="text-[12.5px] text-ink/80">Confirmed by the ground team{f?.fieldReport ? ` at ${f.fieldReport.clock}` : ''}. Drones are returning to base.</p>
        <button onClick={() => navigate(`/recovery/${id}`)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-ok px-3 py-2 text-[13px] font-semibold text-white">
          <MapIcon size={15} /> View recovery map
        </button>
      </Card>
    );
  }

  if (phase === 'closed') return <Card tone="muted" icon={<Power size={18} />} kicker="Closed" title="This search was stood down" />;

  const engine = engineDriven.has(id);
  if (phase === 'ready')
    return (
      <Card tone="accent" icon={<Rocket size={18} />} kicker="Next step" title="Launch the drones">
        <p className="text-[12.5px] text-ink/80">
          The shaded area is where {first} is most likely to be.{' '}
          {engine ? 'The LIFELINE engine flies the drones; launching starts its run.' : `${sim.drones.length} drones will sweep the most likely spots first.`}
        </p>
        <button onClick={() => start(id)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-[13.5px] font-semibold text-white hover:brightness-110">
          <Rocket size={15} /> {engine ? 'Launch engine run' : `Launch ${sim.drones.length} drones`}
        </button>
      </Card>
    );

  return (
    <Card tone="accent" icon={<Radar size={18} />} kicker="In progress" title="Drones are searching">
      <p className="text-[12.5px] text-ink/80">Sweeping the most likely areas first. You'll be alerted the moment a drone picks up a possible person.</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-muted">
        <div className="rounded-lg bg-panel px-2 py-1.5">
          <div className="text-[14px] font-semibold tabular-nums text-ink">{sim.stats.dronesAirborne}</div>
          in the air
        </div>
        <div className="rounded-lg bg-panel px-2 py-1.5">
          <div className="text-[14px] font-semibold tabular-nums text-ink">{sim.stats.blocksSearched}</div>
          squares done
        </div>
        <div className="rounded-lg bg-panel px-2 py-1.5">
          <div className="text-[14px] font-semibold tabular-nums text-ink">{sim.stats.distanceKm.toFixed(0)} km</div>
          flown
        </div>
      </div>
    </Card>
  );
}

const CARD_TONE = {
  accent: 'border-l-accent text-accent',
  warn: 'border-l-warn text-warn',
  crit: 'border-l-crit text-crit',
  ok: 'border-l-ok text-ok',
  muted: 'border-l-line text-muted',
};

function Card({ tone, icon, kicker, title, children }: { tone: keyof typeof CARD_TONE; icon: JSX.Element; kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <section className={clsx('rounded-lg border border-line border-l-[3px] bg-panel p-4', CARD_TONE[tone])}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[12px] font-medium">{kicker}</span>
      </div>
      <div className="mt-1.5 text-[16px] font-semibold text-ink">{title}</div>
      {children && <div className="mt-1">{children}</div>}
    </section>
  );
}

function SightingCard({
  sig,
  sim,
  env,
  first,
  onFocus,
  onDispatch,
  onDismiss,
}: {
  sig: DetectionSignal;
  sim: SimState;
  env: MissionEnvironment;
  first: string;
  onFocus: (x: number, y: number, zoom?: number) => void;
  onDispatch: () => void;
  onDismiss: () => void;
}) {
  const ll = cellToLatLon(env.grid, sig.x, sig.y);
  const drone = sim.drones.find((d) => d.id === sig.droneId);
  const dist = (Math.hypot(sig.x - env.base.x, sig.y - env.base.y) * env.grid.cellSizeM) / 1000;
  return (
    <section className="overflow-hidden rounded-lg border border-crit/50 border-l-[3px] border-l-crit bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-crit">
        <Radar size={15} />
        <span className="text-[12.5px] font-semibold">Possible sighting</span>
        <span className="ml-auto font-mono text-[11px] text-muted">{sig.clock}</span>
      </div>
      <div className="p-4">
        <div className="text-[15px] font-semibold text-ink">Is this {first}?</div>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Drone <span style={{ color: drone?.color }} className="font-semibold">{sig.droneId}</span> picked up a heat signature. A sighting is only confirmed once the ground team sees them.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg">
          <ThermalFrame seed={sig.tick * 7 + sig.id.length} humanLike={sig.isTrue} width={316} height={150} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-base px-3 py-2">
            <div className="text-muted">Match confidence</div>
            <div className="text-[15px] font-semibold text-ink">{Math.round(sig.confidence * 100)}%</div>
          </div>
          <div className="rounded-lg bg-base px-3 py-2">
            <div className="text-muted">From base</div>
            <div className="text-[15px] font-semibold text-ink">{dist.toFixed(1)} km</div>
          </div>
        </div>
        <div className="mt-2 font-mono text-[11.5px] text-muted">{formatLatLon(ll.latitude, ll.longitude, 5)}</div>
        <button onClick={onDispatch} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-crit px-3 py-2.5 text-[13.5px] font-semibold text-white hover:brightness-110">
          <Footprints size={15} /> Send ground team to check
        </button>
        <div className="mt-2 flex gap-2">
          <button onClick={() => onFocus(sig.x, sig.y, 4)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-elevated">
            <Crosshair size={14} /> Show on map
          </button>
          <button onClick={onDismiss} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12.5px] font-medium text-muted hover:text-ink">
            <X size={14} /> Not a person
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------
function Progress({ sim, env, onFocus }: { sim: SimState; env: MissionEnvironment; onFocus: (x: number, y: number, zoom?: number) => void }) {
  const st = sim.stats;
  const peakBlock = env.blocks[Math.floor(st.peak.y / BLOCK) * env.blocksW + Math.floor(st.peak.x / BLOCK)];
  const up = st.dronesAirborne;
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-ink">Search progress</h3>
        <span className="text-[11.5px] text-muted">Search time {formatElapsed(sim.elapsedSec)}</span>
      </div>
      <div className="rounded-lg border border-line p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[12.5px] text-muted">Area searched</span>
          <span className="text-[20px] font-semibold tabular-nums text-ink">{Math.round(st.coverage * 100)}%</span>
        </div>
        <ProgressBar value={st.coverage} height={8} className="mt-1" />
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-base px-3 py-2" title="Share of the probability that lies in places no drone has searched yet">
            <div className="text-muted">Chance in unsearched area</div>
            <div className="text-[15px] font-semibold tabular-nums text-ink">{Math.round(st.unexploredMass * 100)}%</div>
          </div>
          <div className="rounded-lg bg-base px-3 py-2">
            <div className="text-muted">Drones in the air</div>
            <div className="text-[15px] font-semibold tabular-nums text-ink">
              {up}
              <span className="text-[12px] font-normal text-muted"> / {sim.drones.length}</span>
            </div>
          </div>
        </div>
        <button onClick={() => onFocus(st.peak.x + 0.5, st.peak.y + 0.5, 6)} className="mt-2 flex w-full items-center gap-2 rounded-lg bg-[#7C3AED]/[0.07] px-3 py-2 text-left text-[12px] hover:bg-[#7C3AED]/[0.12]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#6A2BD6]" />
          <span className="flex-1 text-ink">
            Most likely spot right now{peakBlock ? <span className="text-muted"> · sector {peakBlock.sector}</span> : null}
          </span>
          <span className="font-medium text-accent">Show</span>
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------
function DroneList({ sim, onFocusDrone, selectedDroneId }: { sim: SimState; onFocusDrone: (id: string) => void; selectedDroneId: string | null }) {
  return (
    <div className="divide-y divide-line">
      {sim.drones.map((d) => {
        const meta = STATUS_META[d.status];
        return (
          <button key={d.id} onClick={() => onFocusDrone(d.id)} className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors', selectedDroneId === d.id ? 'bg-accent/5' : 'hover:bg-elevated')}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">{d.id}</span>
                <span className="text-[11.5px]" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </div>
              <div className="truncate text-[11.5px] text-muted">{d.objective}</div>
            </div>
            <div className="w-[64px] shrink-0">
              <div className="text-right text-[11.5px] font-medium tabular-nums text-ink">{Math.round(d.battery)}%</div>
              <ProgressBar value={d.battery / 100} color={d.battery < 20 ? '#E5364B' : d.battery < 40 ? '#C88A04' : '#0E9F6E'} height={4} className="mt-0.5" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ActivityLog({ sim }: { sim: SimState }) {
  const entries = useMemo(() => sim.log.slice(-200).reverse(), [sim.log]);
  return (
    <div className="space-y-px p-2">
      {entries.map((e) => (
        <div key={e.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-[12px] hover:bg-elevated">
          <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LOG_COLORS[e.type] }} />
          <span className="min-w-0 flex-1 text-ink/90">{e.message}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted">{e.clock.slice(0, 5)}</span>
        </div>
      ))}
      {!entries.length && <div className="p-6 text-center text-[12px] text-muted">Nothing yet. Launch the drones to start the search.</div>}
    </div>
  );
}

function Details({ mission, session, onFocus }: { mission: Mission; session: Session; onFocus: (x: number, y: number, zoom?: number) => void }) {
  const standDown = useAppStore((s) => s.standDown);
  const [confirm, setConfirm] = useState(false);
  const { sim, env } = session;
  const r = env.report;
  const lkpLL = cellToLatLon(env.grid, env.lkp.x + 0.5, env.lkp.y + 0.5);
  return (
    <div className="space-y-4 p-4">
      <div>
        <KV k="Last seen at" v={formatLatLon(lkpLL.latitude, lkpLL.longitude)} mono />
        <KV k="Doing" v={r.activity} />
        <KV k="Wearing" v={r.clothing} />
        <KV k="Description" v={r.description} />
        <KV k="Medical" v={r.medical} />
        <KV k="Experience" v={r.experience} />
        <KV k="Weather (mock)" v={`${r.weather.summary} · ${r.weather.tempC}°C`} />
      </div>
      {sim.signals.length > 0 && (
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink">Sightings</div>
          <div className="space-y-1.5">
            {sim.signals.map((s) => (
              <button key={s.id} onClick={() => onFocus(s.x, s.y, 6)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[12px] hover:bg-elevated">
                <span className="font-medium text-ink">{s.clock.slice(0, 5)}</span>
                <span className="text-muted">by {s.droneId}</span>
                <span className="ml-auto">
                  <Badge color={SIGNAL_STATUS_META[s.status].color}>{SIGNAL_STATUS_META[s.status].label}</Badge>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {sim.status !== 'complete' && (
        <div className="border-t border-line pt-3">
          {!confirm ? (
            <button onClick={() => setConfirm(true)} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-crit">
              <Power size={13} /> Stand down this search…
            </button>
          ) : (
            <div className="rounded-lg border border-crit/40 bg-crit/5 p-3 text-[12px]">
              <div className="text-ink">Stand down {mission.id}? Drones return to base and are released to the fleet.</div>
              <div className="mt-2 flex gap-2">
                <button className="rounded-md bg-crit px-3 py-1 font-semibold text-white" onClick={() => standDown(mission.id)}>
                  Stand down
                </button>
                <button className="rounded-md border border-line px-3 py-1 text-muted" onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
