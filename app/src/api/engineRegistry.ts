import type { SimDrone } from '../types/drone';

/**
 * Which searches are driven by the backend engine. Kept in its own module so the app store can
 * check it without importing the link (which imports the store).
 */
export const engineDriven = new Set<string>();
/** Searches whose engine stream has ended; only the ground-team clock keeps running locally. */
export const engineEnded = new Set<string>();
/** Airframe specs (sensor footprint, detection odds, colours) lent to engine drones per search. */
export const engineDroneTemplates = new Map<string, SimDrone[]>();

export const engineHandlers: {
  start?: (missionId: string, speed: number) => void;
  reset?: (missionId: string) => void;
} = {};
