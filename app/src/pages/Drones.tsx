/**
 * Drone Status — one live table of every airframe: status, battery, position, mission, assigned
 * search cells and current task. Rows merge static fleet records with simulation telemetry.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Crosshair, MapPin, Search, X } from 'lucide-react';
import type { DroneStatus, FleetDrone, SimDrone } from '../types/drone';
import type { Mission } from '../types/mission';
import type { MissionEnvironment } from '../types/simulation';
import { Badge, ProgressBar, SectionLabel, Segmented, SimulatedTag } from '../components/ui';
import DroneModel from '../components/fleet/DroneModel';
import { useAppStore } from '../store/appStore';
import { AIRBORNE_STATUSES, STATUS_META, fleetStatus, liveDrone } from '../services/droneService';
import { cellToLatLon } from '../services/terrainService';
import { TICK_SEC } from '../services/simulationService';
import { formatLatLon } from '../lib/format';

type Group = 'all' | 'airborne' | 'available' | 'down';

interface Row {
  f: FleetDrone;
  status: DroneStatus;
  battery: number;
  missionId: string | null;
  mission: Mission | undefined;
  live: SimDrone | null;
  env: MissionEnvironment | null;
  group: Exclude<Group, 'all'>;
}

export function batteryColor(b: number) {
  return b < 20 ? '#E5364B' : b < 40 ? '#C88A04' : '#0E9F6E';
}

function groundSpeed(d: SimDrone, env: MissionEnvironment) {
  const cells = d.status === 'searching' ? d.speedSearch : d.status === 'en_route' || d.status === 'returning' ? d.speedTransit : 0;
  return (cells * env.grid.cellSizeM) / TICK_SEC;
}

export default function Drones() {
  const fleet = useAppStore((s) => s.fleet);
  const sessions = useAppStore((s) => s.sessions);
  const missions = useAppStore((s) => s.missions);
  const [group, setGroup] = useState<Group>('all');
  const [missionFilter, setMissionFilter] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const rows: Row[] = fleet.map((f) => {
    const st = fleetStatus(f, sessions);
    const ld = liveDrone(f.id, sessions);
    const live = ld?.drone ?? null;
    const env = ld ? sessions[ld.missionId].env : null;
    const group: Row['group'] = AIRBORNE_STATUSES.includes(st.status) ? 'airborne' : st.status === 'charging' || st.status === 'maintenance' ? 'down' : 'available';
    return { f, ...st, mission: missions.find((m) => m.id === st.missionId), live, env, group };
  });
  const counts = {
    airborne: rows.filter((r) => r.group === 'airborne').length,
    available: rows.filter((r) => r.group === 'available').length,
    down: rows.filter((r) => r.group === 'down').length,
  };
  const filtered = rows.filter(
    (r) =>
      (group === 'all' || r.group === group) &&
      (missionFilter === 'all' || (missionFilter === 'none' ? !r.missionId : r.missionId === missionFilter)) &&
      (!q || `${r.f.id} ${r.f.name} ${r.f.callsign} ${r.f.spec.model}`.toLowerCase().includes(q.toLowerCase())),
  );
  const sel = rows.find((r) => r.f.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1400px] space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[22px] font-semibold tracking-tight text-ink">Drone status</h2>
                <SimulatedTag />
              </div>
              <p className="mt-1 text-[13px] text-muted">Live battery, position and search assignments for all {fleet.length} drones.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Count label="In the air" value={counts.airborne} color="#2556E8" />
            <Count label="Available" value={counts.available} color="#0E9F6E" />
            <Count label="Charging / maintenance" value={counts.down} color="#C88A04" />
            <Count label="Low battery (< 20%)" value={rows.filter((r) => r.battery < 20).length} color="#E5364B" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              size="sm"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: `All ${rows.length}` },
                { value: 'airborne', label: `In the air ${counts.airborne}` },
                { value: 'available', label: `Available ${counts.available}` },
                { value: 'down', label: `Charging / maint. ${counts.down}` },
              ]}
            />
            <select value={missionFilter} onChange={(e) => setMissionFilter(e.target.value)} className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink">
              <option value="all">All missions</option>
              <option value="none">Not assigned</option>
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.missingPerson}
                </option>
              ))}
            </select>
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a drone…"
                className="w-[220px] rounded-lg border border-line bg-panel py-1.5 pl-8 pr-3 text-[12.5px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-panel">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-muted">
                  {['Drone', 'Status', 'Battery', 'Position', 'Mission', 'Assigned cells', 'Current task', ''].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <DroneRow key={r.f.id} r={r} selected={selected === r.f.id} onSelect={() => setSelected(r.f.id)} />
                ))}
              </tbody>
            </table>
            {!filtered.length && <div className="p-10 text-center text-sm text-muted">No drones match these filters.</div>}
          </div>
        </div>
      </div>
      {sel && <DroneDrawer r={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-[26px] font-semibold leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] text-muted">{label}</div>
    </div>
  );
}

function useShowOnMap() {
  const navigate = useNavigate();
  const focusMap = useAppStore((s) => s.focusMap);
  const setCurrent = useAppStore((s) => s.setCurrentMission);
  return (missionId: string, x: number, y: number) => {
    setCurrent(missionId);
    navigate(`/map/${missionId}`);
    setTimeout(() => focusMap(missionId, x, y, 5), 60);
  };
}

function position(r: Row) {
  if (r.live && r.env) {
    const ll = cellToLatLon(r.env.grid, r.live.x, r.live.y);
    return { ll: formatLatLon(ll.latitude, ll.longitude, 4), alt: `${Math.round(r.live.altitude).toLocaleString()} m alt.` };
  }
  return { ll: r.f.homeBase, alt: 'On the ground' };
}

function DroneRow({ r, selected, onSelect }: { r: Row; selected: boolean; onSelect: () => void }) {
  const meta = STATUS_META[r.status];
  const showOnMap = useShowOnMap();
  const pos = position(r);
  const cells = r.live?.assignedCells ?? [];
  const task = r.live ? r.live.objective : r.status === 'maintenance' ? 'Grounded for maintenance' : r.status === 'charging' ? 'Charging at base' : r.missionId ? 'Waiting for launch' : 'Ready for tasking';
  return (
    <tr onClick={onSelect} className={clsx('cursor-pointer border-b border-line/70 transition-colors last:border-0', selected ? 'bg-accent/5' : 'hover:bg-elevated/70')}>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.f.color }} />
          <div>
            <div className="font-mono font-semibold text-ink">{r.f.id}</div>
            <div className="text-[11px] text-muted">{r.f.callsign}</div>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <Badge color={meta.color} pulse={AIRBORNE_STATUSES.includes(r.status)}>
          {meta.label}
        </Badge>
      </td>
      <td className="w-[150px] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ProgressBar value={r.battery / 100} color={batteryColor(r.battery)} className="!w-16 shrink-0" height={6} />
          <span className="w-9 text-right font-mono text-[11.5px] text-ink">{Math.round(r.battery)}%</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className={clsx('text-[11.5px]', r.live ? 'font-mono text-ink' : 'text-ink')}>{pos.ll}</div>
        <div className="text-[11px] text-muted">{pos.alt}</div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        {r.mission ? (
          <>
            <div className="font-mono text-[11.5px] text-ink">{r.mission.id}</div>
            <div className="text-[11px] text-muted">{r.mission.missingPerson}</div>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {cells.length ? (
          <div className="flex flex-wrap gap-1">
            {cells.slice(0, 3).map((c, i) => (
              <span key={c} className={clsx('rounded px-1.5 py-px font-mono text-[10.5px]', i === 0 && r.live?.currentBlock !== -1 ? 'bg-accent/10 text-accent' : 'bg-base text-muted')}>
                {c}
              </span>
            ))}
            {cells.length > 3 && <span className="text-[10.5px] text-muted">+{cells.length - 3}</span>}
          </div>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="max-w-[260px] truncate px-4 py-2.5 text-[12px] text-ink/90" title={task}>
        {task}
      </td>
      <td className="px-3 py-2.5 text-right">
        {r.live && r.missionId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              showOnMap(r.missionId!, r.live!.x, r.live!.y);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
            title="Show this drone on the map"
          >
            <Crosshair size={12} /> Map
          </button>
        )}
      </td>
    </tr>
  );
}

function DroneDrawer({ r, onClose }: { r: Row; onClose: () => void }) {
  const showOnMap = useShowOnMap();
  const { f, live, env } = r;
  const meta = STATUS_META[r.status];
  const ll = useMemo(() => (live && env ? cellToLatLon(env.grid, live.x, live.y) : null), [live, env, live?.x, live?.y]);
  const minutesLeft = (r.battery / 100) * f.spec.flightTimeMin;
  return (
    <aside className="flex w-[400px] shrink-0 animate-slideIn flex-col border-l border-line bg-panel">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <DroneModel spec={f.spec} color={f.color} size={64} spinning={AIRBORNE_STATUSES.includes(r.status)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold" style={{ color: f.color }}>
              {f.id}
            </span>
            <span className="text-sm text-muted">{f.callsign}</span>
          </div>
          <div className="text-[12.5px] text-ink">{f.spec.model}</div>
          <div className="mt-1">
            <Badge color={meta.color}>{meta.label}</Badge>
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-elevated hover:text-ink" title="Close">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <SectionLabel>Battery</SectionLabel>
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-semibold tabular-nums" style={{ color: batteryColor(r.battery) }}>
              {r.battery.toFixed(0)}%
            </span>
            <span className="text-[12px] text-muted">≈ {Math.round(minutesLeft)} min of flight left</span>
          </div>
          <ProgressBar value={r.battery / 100} color={batteryColor(r.battery)} height={8} className="mt-1.5" />
          <div className="mt-1 text-[11px] text-muted">Battery health {f.batteryHealth}% · returns to base at 20%</div>
        </div>

        <div>
          <SectionLabel>Position</SectionLabel>
          {live && env && ll ? (
            <div className="grid grid-cols-2 gap-2">
              <Field k="Latitude / longitude" v={formatLatLon(ll.latitude, ll.longitude, 4)} span />
              <Field k="Altitude" v={`${Math.round(live.altitude).toLocaleString()} m`} />
              <Field k="Above ground" v={`${Math.round(live.agl)} m`} />
              <Field k="Heading" v={`${Math.round(live.heading).toString().padStart(3, '0')}°`} />
              <Field k="Ground speed" v={`${groundSpeed(live, env).toFixed(1)} m/s`} />
              <Field k="Distance flown" v={`${(live.distanceM / 1000).toFixed(2)} km`} />
              <Field k="Cells searched" v={`${live.cellsSearched}`} />
            </div>
          ) : (
            <div className="rounded-lg bg-base px-3 py-2.5 text-[12.5px] text-ink">
              <MapPin size={13} className="mr-1.5 inline text-muted" />
              On the ground at {f.homeBase}
            </div>
          )}
        </div>

        <div>
          <SectionLabel>Assignment</SectionLabel>
          {r.mission ? (
            <div className="space-y-2 rounded-lg bg-base p-3 text-[12.5px]">
              <div>
                <span className="font-mono text-muted">{r.mission.id}</span> · <span className="font-medium text-ink">Search for {r.mission.missingPerson}</span>
              </div>
              {live && <div className="text-ink/90">{live.objective}</div>}
              <div>
                <div className="mb-1 text-[11px] text-muted">Assigned search cells ({live?.assignedCells.length ?? 0})</div>
                {live && live.assignedCells.length ? (
                  <div className="flex flex-wrap gap-1">
                    {live.assignedCells.map((c, i) => (
                      <span key={c} className={clsx('rounded px-1.5 py-px font-mono text-[11px]', i === 0 && live.currentBlock !== -1 ? 'bg-accent text-white' : 'bg-panel text-ink')}>
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11.5px] text-muted">None right now. Cells are assigned by auction during the search.</div>
                )}
              </div>
              {live && r.missionId && (
                <button
                  onClick={() => showOnMap(r.missionId!, live.x, live.y)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:brightness-110"
                >
                  <Crosshair size={13} /> Show on map
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-base px-3 py-2.5 text-[12.5px] text-muted">{r.status === 'maintenance' ? 'Grounded for scheduled maintenance.' : 'Not assigned to a mission.'}</div>
          )}
        </div>

        <div>
          <SectionLabel>Aircraft</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field k="Max flight time" v={`${f.spec.flightTimeMin} min`} />
            <Field k="Cruise speed" v={`${f.spec.cruiseSpeedMs} m/s`} />
            <Field k="Range" v={`${f.spec.rangeKm} km`} />
            <Field k="Airframe" v={f.spec.airframe} />
            <Field k="Thermal camera" v={f.spec.thermal} span />
          </div>
        </div>
      </div>
    </aside>
  );
}

function Field({ k, v, span }: { k: string; v: string; span?: boolean }) {
  return (
    <div className={clsx('rounded-lg bg-base px-3 py-2', span && 'col-span-2')}>
      <div className="text-[10.5px] text-muted">{k}</div>
      <div className="mt-0.5 text-[12.5px] font-medium text-ink">{v}</div>
    </div>
  );
}
