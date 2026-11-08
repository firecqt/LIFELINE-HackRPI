import { APP_NOW } from './clock';

export type ActivityKind = 'deploy' | 'assignment' | 'probability' | 'detection' | 'ranger' | 'warning' | 'system';

export interface ActivityItem {
  id: string;
  at: number; // wall-clock ms
  missionId: string | null;
  kind: ActivityKind;
  message: string;
}

const MIN = 60_000;

/** SIMULATED operations feed shown before live sessions start producing events. */
export const MOCK_ACTIVITY: ActivityItem[] = [
  { id: 'a1', at: APP_NOW - 2 * MIN, missionId: 'M-003', kind: 'system', message: 'Mission environment initialized — D-07 … D-12 on standby at base, awaiting launch' },
  { id: 'a2', at: APP_NOW - 5 * MIN, missionId: 'M-001', kind: 'system', message: 'Mission environment initialized — D-01 … D-04 on standby at base, awaiting launch' },
  { id: 'a3', at: APP_NOW - 9 * MIN, missionId: 'M-002', kind: 'system', message: 'Mission environment initialized — D-05, D-06 on standby at base, awaiting launch' },
  { id: 'a4', at: APP_NOW - 34 * MIN, missionId: null, kind: 'system', message: 'Fleet sync complete — 20 airframes reporting' },
];
