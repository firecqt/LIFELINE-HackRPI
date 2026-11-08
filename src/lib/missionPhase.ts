/**
 * Mission phase + "what should I do next" — the single source of truth the dashboard, sidebar
 * and map use to tell the ranger where each search stands and which action moves it forward.
 */
import type { Mission } from '../types/mission';
import type { DetectionSignal } from '../types/simulation';
import type { Session } from '../store/appStore';
import { TICK_SEC } from '../services/simulationService';

export type Phase = 'ready' | 'searching' | 'review' | 'en_route' | 'on_scene' | 'found' | 'closed';

export const PHASE_META: Record<Phase, { label: string; color: string; step: number; pulse?: boolean }> = {
  ready: { label: 'Not started', color: '#5F6B7D', step: 0 },
  searching: { label: 'Searching', color: '#2556E8', step: 1 },
  review: { label: 'Possible sighting', color: '#E5364B', step: 2, pulse: true },
  en_route: { label: 'Team en route', color: '#C88A04', step: 2 },
  on_scene: { label: 'Team on scene', color: '#E5364B', step: 2, pulse: true },
  found: { label: 'Found', color: '#0E9F6E', step: 3 },
  closed: { label: 'Closed', color: '#5F6B7D', step: 3 },
};

/** The four stages shown in every stepper. */
export const STEPS = ['Plan', 'Search', 'Verify', 'Found'] as const;

export function missionPhase(m: Mission, sess?: Session | null): Phase {
  if (!sess) return m.status === 'initializing' || m.status === 'ready' ? 'ready' : 'searching';
  const s = sess.sim;
  if (s.outcome === 'located') return 'found';
  if (s.outcome) return 'closed';
  if (s.signals.some((x) => x.status === 'on_scene')) return 'on_scene';
  if (s.signals.some((x) => x.status === 'pending')) return 'review';
  if (s.signals.some((x) => x.status === 'verifying')) return 'en_route';
  if (s.status === 'ready') return 'ready';
  return 'searching';
}

/** The signal the current phase is about (pending review, team en route or on scene). */
export function activeSignal(sess?: Session | null): DetectionSignal | null {
  if (!sess) return null;
  const sigs = sess.sim.signals;
  return sigs.find((x) => x.status === 'on_scene') ?? sigs.find((x) => x.status === 'pending') ?? sigs.find((x) => x.status === 'verifying') ?? null;
}

export function teamEtaMinutes(sess: Session, sig: DetectionSignal): number {
  return Math.max(0, Math.round((((sig.etaTick ?? sess.sim.tick) - sess.sim.tick) * TICK_SEC) / 60));
}

export interface NextAction {
  title: string;
  detail: string;
  cta: string | null;
  /** Route to open, or a store action key. */
  to?: string;
  action?: 'start';
  urgent: boolean;
}

export function nextAction(m: Mission, sess?: Session | null): NextAction {
  const phase = missionPhase(m, sess);
  const sig = activeSignal(sess);
  const first = m.missingPerson.split(' ')[0];
  switch (phase) {
    case 'ready':
      return { title: 'Launch the drones', detail: `The search area for ${first} is mapped. Launch to start sweeping the most likely areas first.`, cta: 'Launch drones', action: 'start', urgent: false };
    case 'review':
      return { title: 'Review a possible sighting', detail: `Drone ${sig?.droneId ?? ''} picked up a heat signature that could be ${first}. Send the ground team or dismiss it.`, cta: 'Review sighting', to: `/map/${m.id}`, urgent: true };
    case 'en_route':
      return {
        title: 'Ground team on the way',
        detail: `About ${sess && sig ? teamEtaMinutes(sess, sig) : '?'} min until they reach the sighting. Drones keep searching meanwhile.`,
        cta: 'Open ground team',
        to: `/ground?mission=${m.id}&signal=${sig?.id ?? ''}`,
        urgent: false,
      };
    case 'on_scene':
      return { title: 'Team needs to confirm', detail: `The team reached the sighting. Confirm whether it is ${first}.`, cta: 'Confirm on scene', to: `/ground?mission=${m.id}&signal=${sig?.id ?? ''}`, urgent: true };
    case 'found':
      return { title: `${first} has been found`, detail: 'See where they were found and how they likely got there.', cta: 'View recovery map', to: `/recovery/${m.id}`, urgent: false };
    case 'closed':
      return { title: 'Search closed', detail: 'This mission was stood down.', cta: null, urgent: false };
    default:
      return { title: 'Search in progress', detail: 'Drones are sweeping the most likely areas first. You will be alerted to any possible sighting.', cta: null, urgent: false };
  }
}
