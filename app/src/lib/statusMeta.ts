import type { MissionStatus, Priority } from '../types/mission';
import type { SignalStatus } from '../types/simulation';

export const MISSION_STATUS_META: Record<MissionStatus, { label: string; color: string; pulse?: boolean }> = {
  initializing: { label: 'Preparing', color: '#5F6B7D', pulse: true },
  ready: { label: 'Ready to launch', color: '#2556E8' },
  active: { label: 'Searching', color: '#2556E8', pulse: true },
  high_priority: { label: 'Searching', color: '#2556E8', pulse: true },
  paused: { label: 'Paused', color: '#C88A04' },
  detection: { label: 'Needs review', color: '#E5364B', pulse: true },
  verifying: { label: 'Team verifying', color: '#C88A04', pulse: true },
  located: { label: 'Found', color: '#0E9F6E' },
  suspended: { label: 'Suspended', color: '#5F6B7D' },
  stood_down: { label: 'Stood Down', color: '#5F6B7D' },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string; rank: number }> = {
  critical: { label: 'Critical', color: '#E5364B', rank: 4 },
  high: { label: 'High', color: '#C88A04', rank: 3 },
  medium: { label: 'Medium', color: '#2556E8', rank: 2 },
  low: { label: 'Low', color: '#5F6B7D', rank: 1 },
};

export const SIGNAL_STATUS_META: Record<SignalStatus, { label: string; color: string }> = {
  pending: { label: 'Awaiting ranger', color: '#E5364B' },
  verifying: { label: 'Team en route', color: '#C88A04' },
  on_scene: { label: 'Team on scene', color: '#C88A04' },
  confirmed: { label: 'Subject confirmed', color: '#0E9F6E' },
  not_subject: { label: 'Not the subject', color: '#5F6B7D' },
  false_positive: { label: 'Not a person', color: '#5F6B7D' },
  dismissed: { label: 'Dismissed', color: '#5F6B7D' },
};
