/**
 * groundTeamService — mock field observations for the Ground Team view.
 *
 * In production the team would report what they actually see (radio, photos, a field app).
 * Here the observation is generated from the engine's hidden ground truth (`isTrue`) so the
 * ranger has something realistic to confirm or reject. The verdict is still the team's call.
 */
import type { MissingPersonReport } from '../types/mission';
import type { DetectionSignal, SubjectCondition } from '../types/simulation';
import { hashString } from '../lib/rng';

export const GROUND_TEAM = { callsign: 'Hasty Team 2', members: ['R. Okafor (lead)', 'T. Lindgren (EMT)', 'S. Ahn'] };

export interface FieldObservation {
  kind: 'person' | 'animal' | 'object';
  headline: string;
  details: string[];
  /** What the person says / does when hailed (people only). */
  response: string | null;
}

/** The identity checks the team can tick before confirming the subject. */
export function identityChecks(r: MissingPersonReport): string[] {
  return [`Responds to the name "${r.name.split(' ')[0]}"`, 'Clothing matches the report', `Appearance matches (age ~${r.age}, ${r.heightCm} cm)`, 'Gear or belongings match the report'];
}

export const CONDITION_LABELS: Record<SubjectCondition, string> = {
  uninjured: 'Uninjured — can walk out',
  minor_injuries: 'Minor injuries — assisted walk-out',
  needs_evacuation: 'Needs evacuation — litter or helicopter',
};

export function fieldObservation(sig: DetectionSignal, r: MissingPersonReport, missionId: string): FieldObservation {
  const pronoun = r.sex === 'F' ? 'female' : r.sex === 'M' ? 'male' : 'adult';
  if (sig.isTrue) {
    const cold = r.weather.tempC <= 5;
    return {
      kind: 'person',
      headline: `Adult ${pronoun}, roughly ${r.age - 2}–${r.age + 3} years old`,
      details: [`Wearing: ${r.clothing}`, r.description, cold ? 'Shivering, slow speech: early signs of hypothermia' : 'Alert and oriented, dehydrated', 'Sheltering off-trail, out of sight from the nearest path'],
      response: `Answers to "${r.name.split(' ')[0]}" and gives the same trailhead as the report.`,
    };
  }
  const variant = hashString(`${missionId}|${sig.id}`) % 3;
  if (variant === 0)
    return {
      kind: 'animal',
      headline: 'Elk cow bedded down under canopy',
      details: ['Thermal signature matches a large mammal', 'Fresh tracks lead away to the north-east', 'No human tracks or belongings nearby'],
      response: null,
    };
  if (variant === 1)
    return {
      kind: 'object',
      headline: 'Sun-warmed rock outcrop',
      details: ['Granite slab still holding afternoon heat', 'No tracks, gear or signs of a camp', 'Matches the low-confidence thermal return'],
      response: null,
    };
  return {
    kind: 'person',
    headline: `Adult ${r.sex === 'F' ? 'male' : 'female'} backpacker, about ${r.age + 17}`,
    details: ['Wearing: red rain shell, grey pack with permit tag', 'Camped legally; on a planned overnight route', 'Has not seen anyone matching the report'],
    response: 'Gives a different name; not part of this incident.',
  };
}
