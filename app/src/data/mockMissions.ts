import type { Mission } from '../types/mission';
import { APP_NOW, HOUR } from './clock';
import { MOCK_REPORTS } from './mockReports';
import { parkById } from './mockParks';

function fromReport(id: string, reportId: string, drones: string[], progress: number, status: Mission['status']): Mission {
  const r = MOCK_REPORTS.find((x) => x.id === reportId)!;
  const lastSeen = APP_NOW - r.hoursMissing * HOUR;
  return {
    id,
    missingPerson: r.name,
    park: parkById(r.parkId).name,
    parkId: r.parkId,
    reportId,
    lastKnownPosition: r.lkp,
    timeLastSeen: new Date(lastSeen).toISOString(),
    status,
    priority: r.priority,
    dronesAssigned: drones,
    createdAt: lastSeen + (r.reportDelayH + 0.15) * HOUR,
    progress,
  };
}

/** SIMULATED missions shown on the Overview dashboard at load. All start not started, drones on the ground at base, until launched. */
export const MOCK_MISSIONS: Mission[] = [
  fromReport('M-001', 'INC-26-1107-014', ['D-01', 'D-02', 'D-03', 'D-04'], 0, 'ready'),
  fromReport('M-002', 'INC-26-1107-021', ['D-05', 'D-06'], 0, 'ready'),
  fromReport('M-003', 'INC-26-1107-009', ['D-07', 'D-08', 'D-09', 'D-10', 'D-11', 'D-12'], 0, 'ready'),
];
