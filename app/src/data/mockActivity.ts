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
  { id: 'a1', at: APP_NOW - 2 * MIN, missionId: 'M-003', kind: 'probability', message: 'Probability distribution updated — mass shifting toward Firehole drainage' },
  { id: 'a2', at: APP_NOW - 4 * MIN, missionId: 'M-001', kind: 'assignment', message: 'D-03 won auction for cell C-0687 (bid 412.6)' },
  { id: 'a3', at: APP_NOW - 7 * MIN, missionId: 'M-003', kind: 'warning', message: 'D-09 battery below 25% — return-to-base recommended' },
  { id: 'a4', at: APP_NOW - 9 * MIN, missionId: 'M-002', kind: 'system', message: 'Mission environment initialized — Glacier NP terrain loaded' },
  { id: 'a5', at: APP_NOW - 12 * MIN, missionId: 'M-001', kind: 'ranger', message: 'Ranger J. Alvarez acknowledged sector B clearance' },
  { id: 'a6', at: APP_NOW - 15 * MIN, missionId: 'M-003', kind: 'deploy', message: 'D-11 and D-12 launched from Old Faithful Ranger Station' },
  { id: 'a7', at: APP_NOW - 21 * MIN, missionId: 'M-003', kind: 'detection', message: 'Low-confidence thermal return (0.41) dismissed — elk herd' },
  { id: 'a8', at: APP_NOW - 26 * MIN, missionId: 'M-001', kind: 'deploy', message: 'D-01 … D-04 deployed — Panorama Trail sector' },
  { id: 'a9', at: APP_NOW - 34 * MIN, missionId: null, kind: 'system', message: 'Fleet sync complete — 20 airframes reporting' },
];
