/**
 * Missing persons — every report, grouped by where it stands (new, being searched, found).
 * The detail view leads with the one thing to do for that person, then how to recognize them
 * and where they were last seen.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, CloudSun, Eye, Footprints, HeartPulse, MapPin, Rocket, Search, Shirt, User } from 'lucide-react';
import type { MissingPersonReport } from '../types/mission';
import { Avatar, Badge, KV, Panel, SimulatedTag } from '../components/ui';
import MapPreview from '../components/missions/MapPreview';
import MissionInitializer from '../components/missions/MissionInitializer';
import { parkById } from '../data/mockParks';
import { APP_NOW, HOUR } from '../data/clock';
import { PRIORITY_META } from '../lib/statusMeta';
import { PHASE_META, missionPhase } from '../lib/missionPhase';
import { formatDateTime, formatDuration, formatLatLon } from '../lib/format';
import { missionHoursMissing, useAppStore } from '../store/appStore';

type Group = 'new' | 'searching' | 'found';
type Filter = Group | 'all';

export default function MissingPersons() {
  const reports = useAppStore((s) => s.reports);
  const missions = useAppStore((s) => s.missions);
  const sessions = useAppStore((s) => s.sessions);
  const navigate = useNavigate();
  const setCurrent = useAppStore((s) => s.setCurrentMission);
  const available = useAppStore((s) => s.getAvailableDrones)();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [initializing, setInitializing] = useState<MissingPersonReport | null>(null);

  const groupOf = (r: MissingPersonReport): Group => {
    if (r.status === 'open') return 'new';
    if (r.status === 'resolved') return 'found';
    const s = r.missionId ? sessions[r.missionId] : undefined;
    return s?.sim.outcome === 'located' ? 'found' : 'searching';
  };
  const hoursOf = (r: MissingPersonReport) => {
    const m = r.missionId ? missions.find((x) => x.id === r.missionId) : undefined;
    return m ? missionHoursMissing(m, sessions[m.id], reports) : r.hoursMissing;
  };

  const counts = { new: 0, searching: 0, found: 0 } as Record<Group, number>;
  reports.forEach((r) => counts[groupOf(r)]++);
  const list = useMemo(
    () =>
      reports
        .filter((r) => filter === 'all' || groupOf(r) === filter)
        .filter((r) => !q || `${r.name} ${r.id} ${r.description} ${r.clothing} ${parkById(r.parkId).name}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => ['new', 'searching', 'found'].indexOf(groupOf(a)) - ['new', 'searching', 'found'].indexOf(groupOf(b)) || PRIORITY_META[b.priority].rank - PRIORITY_META[a.priority].rank),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reports, sessions, filter, q],
  );
  const selectedId = params.get('report') ?? list[0]?.id ?? reports[0].id;
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0];
  const select = (id: string) => setParams({ report: id }, { replace: true });

  useEffect(() => {
    if (!params.get('report') && list[0]) select(list[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const group = groupOf(selected);
  const mission = selected.missionId ? missions.find((m) => m.id === selected.missionId) : undefined;
  const phase = mission ? missionPhase(mission, sessions[mission.id]) : null;
  const pr = PRIORITY_META[selected.priority];
  const hours = hoursOf(selected);
  const over = hours > selected.responseWindowH;

  return (
    <div className="flex h-full min-h-0">
      {/* List */}
      <div className="flex w-[380px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="space-y-3 border-b border-line p-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, park, clothing…"
              className="w-full rounded-lg border border-line bg-base py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:bg-panel focus:outline-none"
            />
          </div>
          <div className="flex gap-1 rounded-lg bg-base2 p-0.5">
            {(
              [
                ['all', 'All', reports.length],
                ['new', 'New', counts.new],
                ['searching', 'Searching', counts.searching],
                ['found', 'Found', counts.found],
              ] as [Filter, string, number][]
            ).map(([v, l, n]) => (
              <button key={v} onClick={() => setFilter(v)} className={clsx('flex-1 whitespace-nowrap rounded-md px-1.5 py-1.5 text-[12px] font-medium', filter === v ? 'bg-panel text-ink' : 'text-muted hover:text-ink')}>
                {l} <span className="text-muted">{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map((r) => (
            <ReportRow key={r.id} r={r} group={groupOf(r)} hours={hoursOf(r)} selected={selected.id === r.id} onClick={() => select(r.id)} />
          ))}
          {!list.length && <div className="p-8 text-center text-[12.5px] text-muted">No one matches.</div>}
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1040px] space-y-6 p-6 lg:p-8">
          <div className="flex flex-wrap items-start gap-5">
            <Avatar name={selected.name} size={72} color={group === 'found' ? '#0E9F6E' : '#F26B1D'} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={pr.color}>{pr.label} priority</Badge>
                {group === 'new' && <Badge color="#F26B1D">New report</Badge>}
                {phase && <Badge color={PHASE_META[phase].color} pulse={PHASE_META[phase].pulse}>{PHASE_META[phase].label}</Badge>}
                {group === 'found' && !phase && <Badge color="#0E9F6E">Found</Badge>}
                <SimulatedTag />
              </div>
              <h2 className="mt-1.5 text-[28px] font-semibold tracking-tight text-ink">{selected.name}</h2>
              <div className="text-[13.5px] text-muted">
                {selected.age} yrs · {selected.sex === 'F' ? 'Female' : selected.sex === 'M' ? 'Male' : '—'} · {selected.heightCm} cm · {selected.experience} hiker · {parkById(selected.parkId).name}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {group === 'new' && (
                <>
                  <button
                    onClick={() => setInitializing(selected)}
                    disabled={available.length < 2}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-float hover:brightness-110 disabled:opacity-40"
                  >
                    <Rocket size={17} /> Start search
                  </button>
                  <span className="text-[11.5px] text-muted">{available.length >= 2 ? `${Math.min(6, available.length)} of ${available.length} ready drones will be assigned` : 'Not enough drones available'}</span>
                </>
              )}
              {mission && group === 'searching' && (
                <button
                  onClick={() => {
                    setCurrent(mission.id);
                    navigate(`/map/${mission.id}`);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-float hover:brightness-110"
                >
                  Open search map <ArrowRight size={16} />
                </button>
              )}
              {group === 'found' && mission && (
                <button onClick={() => navigate(`/recovery/${mission.id}`)} className="inline-flex items-center gap-2 rounded-lg bg-ok px-5 py-3 text-[14px] font-semibold text-white shadow-float hover:brightness-110">
                  View recovery map <ArrowRight size={16} />
                </button>
              )}
              {group === 'found' && !mission && <span className="rounded-lg bg-ok/10 px-4 py-2 text-[12.5px] font-medium text-ok">Found by the ground team</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label={group === 'found' ? 'Was missing for' : 'Missing for'} value={formatDuration(hours)} tone={group !== 'found' && over ? 'crit' : undefined} sub={group === 'found' ? undefined : over ? 'Past response window' : `${formatDuration(selected.responseWindowH - hours)} left in window`} />
            <Tile label="Last seen" value={formatDateTime(APP_NOW - selected.hoursMissing * HOUR)} sub={`Reported ${formatDuration(selected.reportDelayH)} later`} />
            <Tile label="Was doing" value={selected.activity.split('—')[0].trim()} small />
            <Tile label="Weather" value={`${selected.weather.tempC}°C`} sub={selected.weather.summary} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="How to recognize them" icon={<Eye size={15} />}>
              <div className="space-y-3 text-[13px]">
                <Row icon={<User size={14} />} label="Description" text={selected.description} />
                <Row icon={<Shirt size={14} />} label="Wearing" text={selected.clothing} />
                <Row icon={<Footprints size={14} />} label="Carrying" text={selected.equipment} />
                <Row icon={<HeartPulse size={14} />} label="Medical" text={selected.medical} />
              </div>
            </Panel>
            <Panel title="Where they were last seen" icon={<MapPin size={15} />}>
              <MapPreview report={selected} height={180} />
              <div className="mt-3">
                <KV k="Coordinates" v={formatLatLon(selected.lkp.latitude, selected.lkp.longitude)} mono />
                <KV k="Activity" v={selected.activity} />
                <KV k="Reported by" v={selected.reportingParty} />
              </div>
            </Panel>
          </div>

          <Panel title="Search planning inputs" icon={<CloudSun size={15} />} subtitle="Used to estimate how far they could have walked (simulated model)">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Walking speed" value={`${selected.hikingSpeedKmh} km/h`} small />
              <Tile label="Terrain" value={selected.terrainDifficulty} small tone={selected.terrainDifficulty === 'Extreme' ? 'crit' : undefined} />
              <Tile label="Tree cover" value={selected.vegetationDensity} sub="Thick cover hides people from drones" small />
              <Tile label="Wind" value={`${selected.weather.windKph} km/h`} sub={`Visibility ${selected.weather.visibilityKm} km`} small />
            </div>
          </Panel>
        </div>
      </div>
      {initializing && <MissionInitializer report={initializing} onCancel={() => setInitializing(null)} />}
    </div>
  );
}

function ReportRow({ r, group, hours, selected, onClick }: { r: MissingPersonReport; group: Group; hours: number; selected: boolean; onClick: () => void }) {
  const over = hours > r.responseWindowH && group !== 'found';
  const label = group === 'new' ? 'New · no search yet' : group === 'searching' ? 'Being searched' : 'Found';
  const color = group === 'new' ? '#F26B1D' : group === 'searching' ? '#2556E8' : '#0E9F6E';
  return (
    <button onClick={onClick} className={clsx('flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors', selected ? 'bg-accent/[0.06]' : 'hover:bg-elevated')}>
      <Avatar name={r.name} size={42} color={group === 'found' ? '#0E9F6E' : '#F26B1D'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-ink">{r.name}</span>
          <span className="text-[12px] text-muted">{r.age}</span>
          {r.priority === 'critical' && group !== 'found' && <span className="rounded-full bg-crit/10 px-1.5 text-[10px] font-semibold text-crit">Critical</span>}
        </div>
        <div className="truncate text-[12px] text-muted">{parkById(r.parkId).name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          {label}
        </div>
      </div>
      <div className="text-right">
        <div className={clsx('text-[13px] font-semibold tabular-nums', over ? 'text-crit' : 'text-ink')}>{formatDuration(hours)}</div>
        <div className="text-[10.5px] text-muted">{group === 'found' ? 'total' : 'missing'}</div>
      </div>
    </button>
  );
}

function Tile({ label, value, sub, tone, small }: { label: string; value: string; sub?: string; tone?: 'crit'; small?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={clsx('mt-0.5 font-semibold', small ? 'text-[14px]' : 'text-[18px] tabular-nums', tone === 'crit' ? 'text-crit' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Row({ icon, label, text }: { icon: JSX.Element; label: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-base text-muted">{icon}</span>
      <div>
        <div className="text-[11.5px] font-medium text-muted">{label}</div>
        <div className="text-ink">{text}</div>
      </div>
    </div>
  );
}
