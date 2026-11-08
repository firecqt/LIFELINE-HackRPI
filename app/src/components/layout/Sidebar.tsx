import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Footprints, LayoutDashboard, Map, Plus, Server, Users } from 'lucide-react';
import { useEngineLinks } from '../../api/backendLink';
import { DroneIcon, LifelineLogo } from '../ui/icons';
import { StatusDot } from '../ui';
import { missionHoursMissing, useAppStore } from '../../store/appStore';
import { PHASE_META, missionPhase } from '../../lib/missionPhase';
import { AIRBORNE_STATUSES, fleetStatus } from '../../services/droneService';
import { formatDuration } from '../../lib/format';

const NAV = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/map', label: 'Search map', icon: <Map size={17} /> },
  { to: '/people', label: 'Missing persons', icon: <Users size={17} /> },
  { to: '/ground', label: 'Ground team', icon: <Footprints size={17} /> },
  { to: '/drones', label: 'Drones', icon: <DroneIcon size={17} /> },
  { to: '/backend', label: 'Backend link', icon: <Server size={17} /> },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const missions = useAppStore((s) => s.missions);
  const sessions = useAppStore((s) => s.sessions);
  const reports = useAppStore((s) => s.reports);
  const fleet = useAppStore((s) => s.fleet);
  const liveLinks = useEngineLinks((s) => Object.values(s.links).filter((l) => l.status === 'streaming').length);
  const currentId = useAppStore((s) => s.currentMissionId);
  const setCurrent = useAppStore((s) => s.setCurrentMission);
  const openReports = reports.filter((r) => r.status === 'open').length;
  const fieldTasks = Object.values(sessions).reduce((n, x) => n + x.sim.signals.filter((g) => g.status === 'on_scene' || g.status === 'verifying').length, 0);
  const onScene = Object.values(sessions).some((x) => x.sim.signals.some((g) => g.status === 'on_scene'));
  const inAir = fleet.filter((f) => AIRBORNE_STATUSES.includes(fleetStatus(f, sessions).status)).length;
  const rows = missions
    .map((m) => ({ m, phase: missionPhase(m, sessions[m.id]), hours: missionHoursMissing(m, sessions[m.id], reports), cov: sessions[m.id]?.sim.stats.coverage ?? 0 }))
    .filter((r) => r.phase !== 'closed');

  return (
    <aside className="flex w-[244px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-line px-5 pb-4 pt-5">
        <LifelineLogo size={34} />
        <div>
          <div className="text-[15px] font-bold tracking-[0.14em] text-ink">LIFELINE</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Search &amp; Rescue</div>
        </div>
      </div>

      <div className="px-3 pt-4">
        <button onClick={() => navigate('/people')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:brightness-110">
          <Plus size={15} /> New search
        </button>
      </div>

      <nav className="mt-4 flex flex-col gap-0.5 px-3">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => clsx('relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', isActive ? 'bg-accent/[0.08] text-accent' : 'text-muted hover:bg-elevated hover:text-ink')}
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent" />}
                {n.icon}
                <span className="flex-1">{n.label}</span>
                {n.to === '/ground' && fieldTasks > 0 && <span className={clsx('rounded px-1.5 text-[11px] font-semibold leading-[18px]', onScene ? 'bg-crit text-white' : 'bg-base2 text-ink')}>{fieldTasks}</span>}
                {n.to === '/people' && openReports > 0 && <span className="rounded bg-base2 px-1.5 text-[11px] font-semibold leading-[18px] text-ink">{openReports}</span>}
                {n.to === '/drones' && <span className="text-[11px] tabular-nums text-muted">{inAir} up</span>}
                {n.to === '/backend' && liveLinks > 0 && <span className="text-[11px] tabular-nums text-ok">{liveLinks} streaming</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col border-t border-line px-3 pt-4">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-[10.5px] font-semibold text-muted">Active searches</span>
          <span className="rounded-full bg-base2 px-1.5 text-[10.5px] font-semibold tabular-nums text-muted">{rows.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-2">
          {rows.map(({ m, phase, hours, cov }) => {
            const meta = PHASE_META[phase];
            const selected = currentId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setCurrent(m.id);
                  navigate(`/map/${m.id}`);
                }}
                className={clsx('w-full rounded-lg border px-3 py-2.5 text-left transition-colors', selected ? 'border-accent/30 bg-accent/[0.05]' : 'border-transparent hover:bg-elevated')}
              >
                <div className="flex items-center gap-2">
                  <StatusDot color={meta.color} pulse={meta.pulse} size={7} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{m.missingPerson}</span>
                  <span className="text-[11px] tabular-nums text-muted">{formatDuration(hours)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-[15px]">
                  <span className="truncate text-[11px]" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  {phase !== 'ready' && phase !== 'found' && (
                    <span className="ml-auto flex items-center gap-1.5 text-[10.5px] tabular-nums text-muted">
                      <span className="h-1 w-10 overflow-hidden rounded-full bg-base2">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${cov * 100}%` }} />
                      </span>
                      {Math.round(cov * 100)}%
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!rows.length && <div className="px-2 text-[12px] text-muted">No active searches.</div>}
        </div>
      </div>

      <div className="border-t border-line px-5 py-3 text-[10.5px] leading-snug text-muted">Prototype · all data simulated locally</div>
    </aside>
  );
}
