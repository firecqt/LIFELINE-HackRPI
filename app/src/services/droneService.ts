/** droneService — fleet helpers that merge static fleet records with live simulation telemetry. */
import type { DroneStatus, FleetDrone, SimDrone } from '../types/drone';
import type { Mission } from '../types/mission';
import type { MissionEnvironment, SimState } from '../types/simulation';

export interface SessionLike {
  env: MissionEnvironment;
  sim: SimState;
}

export const STATUS_META: Record<DroneStatus, { label: string; color: string; short: string }> = {
  standby: { label: 'Standby', color: '#5F6B7D', short: 'STBY' },
  preparing: { label: 'Preparing', color: '#4F46E5', short: 'PREP' },
  launching: { label: 'Launching', color: '#2556E8', short: 'LNCH' },
  en_route: { label: 'En route', color: '#0891B2', short: 'ENRT' },
  searching: { label: 'Searching', color: '#2556E8', short: 'SRCH' },
  returning: { label: 'Returning', color: '#475569', short: 'RTB' },
  charging: { label: 'Charging', color: '#C88A04', short: 'CHRG' },
  low_battery: { label: 'Low battery', color: '#E5364B', short: 'LOWB' },
  maintenance: { label: 'Maintenance', color: '#94A3B8', short: 'MNT' },
};

export function liveDrone(id: string, sessions: Record<string, SessionLike>): { drone: SimDrone; missionId: string } | null {
  for (const [missionId, s] of Object.entries(sessions)) {
    const d = s.sim.drones.find((x) => x.id === id);
    if (d && !(s.sim.status === 'complete' && (d.status === 'charging' || d.status === 'standby'))) return { drone: d, missionId };
  }
  return null;
}

export function fleetStatus(f: FleetDrone, sessions: Record<string, SessionLike>): { status: DroneStatus; battery: number; missionId: string | null } {
  const live = liveDrone(f.id, sessions);
  if (live) return { status: live.drone.status, battery: live.drone.battery, missionId: live.missionId };
  return { status: f.baseStatus, battery: f.battery, missionId: f.assignedMissionId };
}

/** Drones not committed to any mission that is still running. */
export function availableDrones(fleet: FleetDrone[], missions: Mission[], sessions: Record<string, SessionLike>): FleetDrone[] {
  const busy = new Set<string>();
  for (const m of missions) {
    const s = sessions[m.id];
    if (s && s.sim.status === 'complete') continue;
    m.dronesAssigned.forEach((d) => busy.add(d));
  }
  return fleet.filter((f) => !busy.has(f.id) && f.baseStatus !== 'maintenance');
}

export const AIRBORNE_STATUSES: DroneStatus[] = ['launching', 'en_route', 'searching', 'returning', 'low_battery'];
