/**
 * Overview — the operations dashboard. Reads top-down:
 *   status line → KPIs → what needs a decision → every active search (live mini-map) →
 *   season record & field conditions → recent missions & activity.
 */
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Moon, Sun, Activity, AlertTriangle, ArrowRight, BatteryLow, CheckCircle2, CloudSun, Footprints, History, Radar, Rocket, Thermometer, UserPlus, Wind } from 'lucide-react';
import ActivityFeed from '../components/dashboard/ActivityFeed';
import MiniSearchMap from '../components/dashboard/MiniSearchMap';
import { Avatar, Badge, Panel, ProgressBar, Stepper } from '../components/ui';
import { DroneIcon } from '../components/ui/icons';
import { missionHoursMissing, useAppStore, type Session } from '../store/appStore';
import { AIRBORNE_STATUSES, fleetStatus } from '../services/droneService';
import { PHASE_META, missionPhase, nextAction, type Phase } from '../lib/missionPhase';
import { PRIORITY_META } from '../lib/statusMeta';
import { formatDuration } from '../lib/format';
import { APP_NOW } from '../data/clock';
import { parkById } from '../data/mockParks';
import type { HistoricalMission, Mission } from '../types/mission';

interface QueueItem {
  key: string;
  icon: JSX.Element;
  tone: 'crit' | 'warn' | 'accent' | 'hiker';
  title: string;
  detail: string;
  cta: string;
  run: () => void;
}

const TONE: Record<QueueItem['tone'], string> = {
  crit: 'text-crit',
  warn: 'text-warn',
  accent: 'text-accent',
  hiker: 'text-hiker',
};

const OUTCOME_COLOR: Record<HistoricalMission['outcome'], string> = {
  'Located — alive': '#0E9F6E',
  'Located — injured': '#C88A04',
  'Located by ground team': '#0E9F6E',
  'Self-rescued': '#2556E8',
  Suspended: '#5F6B7D',
};

export default function Overview() {
  const navigate = useNavigate();
  const missions = useAppStore((s) => s.missions);
  const sessions = useAppStore((s) => s.sessions);
  const reports = useAppStore((s) => s.reports);
  const fleet = useAppStore((s) => s.fleet);
  const history = useAppStore((s) => s.history);
  const activity = useAppStore((s) => s.activity);
  const ranger = useAppStore((s) => s.settings.rangerName);
  const setCurrent = useAppStore((s) => s.setCurrentMission);
  const start = useAppStore((s) => s.start);

  const openMap = (id: string) => {
    setCurrent(id);
    navigate(`/map/${id}`);
  };
  const runAction = (m: Mission) => {
    const a = nextAction(m, sessions[m.id]);
    if (a.action === 'start') {
      start(m.id);
      openMap(m.id);
    } else if (a.to) {
      setCurrent(m.id);
      navigate(a.to);
    } else openMap(m.id);
  };

  const rows = missions.map((m) => ({ m, sess: sessions[m.id] as Session | undefined, phase: missionPhase(m, sessions[m.id]), hours: missionHoursMissing(m, sessions[m.id], reports) }));
  const active = rows.filter((r) => r.phase !== 'found' && r.phase !== 'closed');
  const found = rows.filter((r) => r.phase === 'found');
  const openReports = reports.filter((r) => r.status === 'open');

  // ---- Action queue ---------------------------------------------------------------------------
  const queue: QueueItem[] = [];
  const order: Phase[] = ['on_scene', 'review', 'ready', 'en_route'];
  for (const ph of order)
    for (const r of active.filter((x) => x.phase === ph)) {
      const a = nextAction(r.m, r.sess);
      queue.push({
        key: `${r.m.id}-${ph}`,
        icon: ph === 'review' ? <Radar size={16} /> : ph === 'ready' ? <Rocket size={16} /> : <Footprints size={16} />,
        tone: ph === 'on_scene' || ph === 'review' ? 'crit' : ph === 'en_route' ? 'warn' : 'accent',
        title: `${a.title} · ${r.m.missingPerson}`,
        detail: a.detail,
        cta: a.cta ?? 'Open map',
        run: () => runAction(r.m),
      });
    }
  for (const rep of openReports)
    queue.push({
      key: `rep-${rep.id}`,
      icon: <UserPlus size={16} />,
      tone: 'hiker',
      title: `New report · ${rep.name}, ${rep.age}`,
      detail: `Missing ${formatDuration(rep.hoursMissing)} in ${parkById(rep.parkId).shortName} · ${PRIORITY_META[rep.priority].label} priority. No search started.`,
      cta: 'Start search',
      run: () => navigate(`/people?report=${rep.id}`),
    });
  for (const { m, sess } of active)
    for (const d of sess?.sim.drones ?? [])
      if (d.battery < 20 && AIRBORNE_STATUSES.includes(d.status))
        queue.push({
          key: `bat-${d.id}`,
          icon: <BatteryLow size={16} />,
          tone: 'warn',
          title: `${d.id} battery at ${Math.round(d.battery)}%`,
          detail: `Heading back to base from the search for ${m.missingPerson}.`,
          cta: 'View drones',
          run: () => navigate('/drones'),
        });

  // ---- Fleet & totals ---------------------------------------------------------------------------
  const live = fleet.map((f) => ({ f, ...fleetStatus(f, sessions) }));
  const inAir = live.filter((x) => AIRBORNE_STATUSES.includes(x.status)).length;
  const charging = live.filter((x) => x.status === 'charging').length;
  const maint = live.filter((x) => x.status === 'maintenance').length;
  const ready = fleet.length - inAir - charging - maint;
  const urgentCount = queue.filter((q) => q.tone === 'crit').length;
  const criticalActive = active.filter((r) => r.m.priority === 'critical').length;

  const sessList = Object.values(sessions);
  const cellKm2 = (s: Session) => (s.env.grid.cellSizeM * s.env.grid.cellSizeM) / 1e6;
  const areaKm2 = sessList.reduce((a, s) => a + s.sim.stats.cellsSearched * cellKm2(s), 0);
  const flownKm = sessList.reduce((a, s) => a + s.sim.stats.distanceKm, 0);
  // Area-searched trend: align each search's coverage history from its latest point.
  const N = 24;
  const areaTrend = Array.from({ length: N }, (_, k) =>
    sessList.reduce((a, s) => {
      const h = s.sim.coverageHistory;
      const idx = h.length - N + k;
      const cov = idx >= 0 ? h[idx]?.coverage ?? 0 : h.length ? 0 : 0;
      return a + cov * s.env.searchAreaCells * cellKm2(s);
    }, 0),
  );
  const located = history.filter((h) => h.outcome.startsWith('Located'));
  const avgFindMin = located.reduce((a, h) => a + (h.detectionMin ?? h.durationMin), 0) / Math.max(1, located.length);
  const airborne = live
    .filter((x) => AIRBORNE_STATUSES.includes(x.status))
    .sort((a, b) => a.battery - b.battery)
    .slice(0, 5);

  const dateLine = new Date(APP_NOW).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-full">
      {/* Header band */}
      <div className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-end gap-6 px-6 pb-6 pt-7 lg:px-8">
          <div>
            <div className="text-[12.5px] text-muted">Operations · {dateLine}</div>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight text-ink">
              {active.length === 0 ? 'No one is missing right now' : `${active.length} ${active.length === 1 ? 'person is' : 'people are'} missing`}
              {urgentCount > 0 && <span className="text-crit"> · {urgentCount} need{urgentCount === 1 ? 's' : ''} you now</span>}
            </h2>
            <p className="mt-1 text-[13.5px] text-muted">
              Ranger {ranger} on duty · {inAir} drones searching across {new Set(active.map((r) => r.m.parkId)).size} parks · {openReports.length} new report{openReports.length === 1 ? '' : 's'} waiting · {fleet.length - maint} of {fleet.length} drones linked
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1480px] space-y-6 p-6 lg:p-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <Kpi label="Active searches" value={`${active.length}`} sub={`${criticalActive} critical · ${openReports.length} not started`} />
          <Kpi label="Area searched" value={areaKm2.toFixed(1)} unit="km²" sub="Across all active searches" spark={areaTrend} />
          <Kpi label="Drones in the air" value={`${inAir}`} unit={`/ ${fleet.length}`} sub={`${ready} ready · ${charging} charging`} bar={inAir / fleet.length} />
          <Kpi label="Distance flown" value={flownKm.toFixed(0)} unit="km" sub={`≈ ${(flownKm / 50).toFixed(1)} flight hours today`} />
          <Kpi label="Found this season" value={`${located.length + found.length}`} unit="people" sub={`Avg ${formatDuration(avgFindMin / 60)} from launch to find`} />
        </div>

        {/* Attention + fleet */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel
            title="Needs your attention"
            icon={<AlertTriangle size={15} className={urgentCount ? 'text-crit' : 'text-muted'} />}
            bodyClass="p-0"
            actions={<span className="text-[11.5px] text-muted">{queue.length ? `${queue.length} item${queue.length === 1 ? '' : 's'}` : ''}</span>}
          >
            {queue.length ? (
              <div className="divide-y divide-line">
                {queue.slice(0, 6).map((q) => (
                  <div key={q.key} className="flex items-center gap-3 px-4 py-3">
                    <span className={clsx('flex w-5 shrink-0 justify-center', TONE[q.tone])}>{q.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-ink">{q.title}</div>
                      <div className="truncate text-[12px] text-muted">{q.detail}</div>
                    </div>
                    <button
                      onClick={q.run}
                      className={clsx(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold',
                        q.tone === 'crit' ? 'bg-crit text-white hover:brightness-110' : 'border border-line text-ink hover:bg-elevated',
                      )}
                    >
                      {q.cta} <ArrowRight size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-6 text-[13px] text-muted">
                <CheckCircle2 size={18} className="text-ok" /> All clear. Drones are searching and nothing needs a decision.
              </div>
            )}
          </Panel>

          <Panel title="Fleet readiness" icon={<DroneIcon size={15} />} actions={<button onClick={() => navigate('/drones')} className="text-[12px] font-medium text-accent hover:underline">All drones</button>}>
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
              {[
                [inAir, '#2556E8'],
                [ready, '#0E9F6E'],
                [charging, '#C88A04'],
                [maint, '#94A3B8'],
              ]
                .filter(([v]) => (v as number) > 0)
                .map(([v, c], i) => (
                  <div key={i} style={{ width: `${((v as number) / fleet.length) * 100}%`, background: c as string }} />
                ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
              {[
                ['In the air', inAir, '#2556E8'],
                ['Ready', ready, '#0E9F6E'],
                ['Charging', charging, '#C88A04'],
                ['Maintenance', maint, '#94A3B8'],
              ].map(([l, v, c]) => (
                <span key={l as string} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: c as string }} />
                  {l} <span className="font-semibold tabular-nums text-ink">{v}</span>
                </span>
              ))}
            </div>
            <div className="mt-4 text-[11.5px] font-semibold text-ink">Lowest batteries in the air</div>
            <div className="mt-2 space-y-2">
              {airborne.map((x) => (
                <div key={x.f.id} className="flex items-center gap-3 text-[12px]">
                  <span className="w-10 font-semibold text-ink">{x.f.id}</span>
                  <ProgressBar value={x.battery / 100} color={x.battery < 20 ? '#E5364B' : x.battery < 40 ? '#C88A04' : '#0E9F6E'} height={6} className="flex-1" />
                  <span className="w-9 text-right tabular-nums text-ink">{Math.round(x.battery)}%</span>
                  <span className="w-12 text-right font-mono text-[10.5px] text-muted">{x.missionId}</span>
                </div>
              ))}
              {!airborne.length && <div className="text-[12px] text-muted">No drones in the air.</div>}
            </div>
          </Panel>
        </div>

        {/* Active searches */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[16px] font-semibold text-ink">Active searches</h3>
            <button onClick={() => navigate('/people')} className="text-[12.5px] font-medium text-accent hover:underline">
              Start a new search
            </button>
          </div>
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {[...active, ...found].map((r) => (
              <SearchCard key={r.m.id} m={r.m} sess={r.sess} phase={r.phase} hours={r.hours} onOpen={() => openMap(r.m.id)} onAction={() => runAction(r.m)} />
            ))}
          </div>
        </section>

        {/* Season + conditions */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel title="Season record" icon={<History size={15} />} subtitle="Search time for the last 8 missions (minutes) · simulated">
            <SeasonChart history={history} />
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-[12px]">
              <MiniStat label="Located" value={`${located.length} / ${history.length}`} />
              <MiniStat label="Median search time" value={`${median(history.map((h) => h.durationMin))} min`} />
              <MiniStat label="Area covered" value={`${history.reduce((a, h) => a + h.areaKm2, 0).toFixed(0)} km²`} />
            </div>
          </Panel>
          <Panel title="Field conditions" icon={<CloudSun size={15} />} subtitle="Weather at each search's last known position · mock" bodyClass="p-0">
            <DaylightNote />
            <div className="divide-y divide-line">
              {active.map(({ m, sess }) => {
                const r = sess?.env.report ?? reports.find((x) => x.id === m.reportId)!;
                const risks = [r.weather.tempC <= 2 && 'Hypothermia risk', r.weather.windKph >= 30 && 'High wind for drones', r.weather.visibilityKm < 5 && 'Low visibility', r.terrainDifficulty === 'Extreme' && 'Extreme terrain'].filter(Boolean) as string[];
                return (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">{m.missingPerson}</span>
                      <span className="text-[12px] text-muted">{parkById(m.parkId).shortName}</span>
                      <span className="ml-auto flex items-center gap-3 text-[12px] tabular-nums text-ink">
                        <span className="flex items-center gap-1">
                          <Thermometer size={13} className="text-muted" />
                          {r.weather.tempC}°C
                        </span>
                        <span className="flex items-center gap-1">
                          <Wind size={13} className="text-muted" />
                          {r.weather.windKph} km/h
                        </span>
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{r.weather.summary}</div>
                    {risks.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {risks.map((x) => (
                          <span key={x} className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn">
                            <AlertTriangle size={11} /> {x}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* History + activity */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel title="Recent missions" icon={<History size={15} />} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] text-muted">
                    {['Date', 'Person', 'Park', 'Search time', 'Drones', 'Area', 'Outcome'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium first:pl-4">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-line/70 last:border-0 hover:bg-elevated/60" title={h.summary}>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">{new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-ink">
                        {h.missingPerson} <span className="font-normal text-muted">{h.age}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink/85">{parkById(h.parkId).shortName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink">{formatDuration(h.durationMin / 60)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">{h.drones}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink">{h.areaKm2} km²</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Badge color={OUTCOME_COLOR[h.outcome]}>{h.outcome}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title="Recent activity"
            icon={<Activity size={15} />}
            bodyClass="p-0 max-h-[420px] overflow-y-auto"
            actions={
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                Live
              </span>
            }
          >
            <ActivityFeed items={activity} limit={30} onOpen={openMap} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Day/night context: thermal drones see people best at night, ground teams move slower. */
function DaylightNote() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const sunset = 16.9;
  const sunrise = 6.8;
  const night = h >= sunset || h < sunrise;
  const left = sunset - h;
  return (
    <div className={clsx('flex items-start gap-3 border-b border-line px-4 py-3 text-[12px]', night ? 'bg-[#1E3A8A]/[0.05]' : 'bg-warn/[0.05]')}>
      <span className={clsx('mt-0.5', night ? 'text-[#1E3A8A]' : 'text-warn')}>{night ? <Moon size={15} /> : <Sun size={15} />}</span>
      <div>
        <div className="font-semibold text-ink">{night ? 'Night operations' : `${formatDuration(left)} of daylight left`}</div>
        <div className="text-muted">
          {night
            ? 'Cold ground makes body heat stand out — thermal detection works best now. Ground teams move slower in the dark.'
            : 'Thermal contrast improves after sunset (about 4:55 PM); plan ground-team routes before dark.'}
        </div>
      </div>
    </div>
  );
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function Sparkline({ data, color = '#2556E8', w = 96 }: { data: number[]; color?: string; w?: number }) {
  const h = 30;
  const max = Math.max(...data, 1e-6);
  const min = Math.min(...data);
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, h - 2 - ((v - min) / Math.max(1e-6, max - min)) * (h - 4)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} fillOpacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />}
    </svg>
  );
}

function Kpi({ label, value, unit, sub, spark, bar }: { label: string; value: string; unit?: string; sub: string; spark?: number[]; bar?: number }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-ink">{value}</span>
          {unit && <span className="text-[13px] text-muted">{unit}</span>}
        </div>
        {spark && <Sparkline data={spark} />}
      </div>
      {bar !== undefined && <ProgressBar value={bar} height={4} className="mt-2.5" />}
      <div className={clsx('text-[11.5px] text-muted', bar !== undefined ? 'mt-1.5' : 'mt-2.5')}>{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function SeasonChart({ history }: { history: HistoricalMission[] }) {
  const data = [...history]
    .sort((a, b) => a.date - b.date)
    .map((h) => ({ name: h.missingPerson.split(' ')[0], min: h.durationMin, outcome: h.outcome, suspended: h.outcome === 'Suspended' }));
  return (
    <div className="h-[210px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ fill: 'rgba(37,86,232,0.06)' }}
            formatter={(v: number, _n, p: { payload?: { outcome?: string } }) => [`${v} min · ${p.payload?.outcome ?? ''}`, 'Search time']}
          />
          <Bar dataKey="min" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.suspended ? '#B8C2D1' : '#2556E8'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SearchCard({ m, sess, phase, hours, onOpen, onAction }: { m: Mission; sess?: Session; phase: Phase; hours: number; onOpen: () => void; onAction: () => void }) {
  const meta = PHASE_META[phase];
  const r = sess?.env.report;
  const windowH = r?.responseWindowH ?? 8;
  const over = hours > windowH;
  const action = nextAction(m, sess);
  const coverage = sess?.sim.stats.coverage ?? m.progress;
  const up = sess ? sess.sim.drones.filter((d) => AIRBORNE_STATUSES.includes(d.status)).length : 0;
  const total = sess?.sim.drones.length ?? m.dronesAssigned.length;
  const covSeries = (sess?.sim.coverageHistory ?? []).slice(-30).map((p) => p.coverage);
  return (
    <div className={clsx('flex flex-col overflow-hidden rounded-lg border bg-panel transition-colors hover:border-[#C9D2DF]', action.urgent ? 'border-crit/60' : 'border-line')}>
      <button onClick={onOpen} className="relative block text-left" title="Open on the search map">
        {sess ? <MiniSearchMap session={sess} height={128} /> : <div className="h-[128px] bg-base2" />}
        <span className="absolute left-3 top-3">
          <span className="inline-flex items-center gap-1.5 rounded bg-panel/95 px-1.5 py-0.5 text-[11px] font-medium" style={{ color: meta.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </span>
        </span>
        <span className="absolute bottom-2 right-3 rounded bg-panel/90 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">{m.park.replace(' National Park', ' NP')}</span>
      </button>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-3">
          <Avatar name={m.missingPerson} size={40} color={phase === 'found' ? '#0E9F6E' : '#F26B1D'} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-ink">{m.missingPerson}</div>
            <div className="truncate text-[12px] text-muted">
              {r ? `${r.age} yrs · ${r.experience} · ` : ''}
              {PRIORITY_META[m.priority].label} priority
            </div>
          </div>
          <div className="text-right">
            <div className={clsx('text-[17px] font-semibold tabular-nums', phase !== 'found' && over ? 'text-crit' : 'text-ink')}>{formatDuration(hours)}</div>
            <div className="text-[10.5px] text-muted">{phase === 'found' ? 'total' : 'missing'}</div>
          </div>
        </div>

        {phase !== 'found' && (
          <div className="mt-3">
            <ProgressBar value={hours / windowH} color={over ? '#E5364B' : hours / windowH > 0.7 ? '#C88A04' : '#0E9F6E'} height={4} />
            <div className="mt-1 text-[11px] text-muted">{over ? `${formatDuration(hours - windowH)} past the ${windowH} h response window` : `${formatDuration(windowH - hours)} left in the ${windowH} h response window`}</div>
          </div>
        )}

        <div className="mt-4">
          <Stepper step={PHASE_META[phase].step} done={phase === 'found'} compact />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-[11.5px]">
          <div className="rounded-lg bg-base px-2.5 py-2">
            <div className="text-muted">Searched</div>
            <div className="flex items-end justify-between">
              <span className="text-[14px] font-semibold tabular-nums text-ink">{Math.round(coverage * 100)}%</span>
              {covSeries.length > 2 && <Sparkline data={covSeries} w={40} />}
            </div>
          </div>
          <div className="rounded-lg bg-base px-2.5 py-2">
            <div className="text-muted">Drones up</div>
            <div className="text-[14px] font-semibold tabular-nums text-ink">
              {up}
              <span className="text-[11.5px] font-normal text-muted">/{total}</span>
            </div>
          </div>
          <div className="rounded-lg bg-base px-2.5 py-2">
            <div className="text-muted" title="Chance the person is somewhere drones have not searched yet">Not yet covered</div>
            <div className="text-[14px] font-semibold tabular-nums text-ink">{sess ? `${Math.round(sess.sim.stats.unexploredMass * 100)}%` : '—'}</div>
          </div>
        </div>

        <button
          onClick={onAction}
          className={clsx(
            'mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold',
            action.urgent ? 'bg-crit text-white hover:brightness-110' : phase === 'found' ? 'bg-ok text-white hover:brightness-110' : action.cta ? 'bg-accent text-white hover:brightness-110' : 'border border-line text-ink hover:bg-elevated',
          )}
        >
          {action.cta ?? 'Open search map'} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
