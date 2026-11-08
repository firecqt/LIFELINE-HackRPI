/**
 * Wire contract with the LIFELINE backend (server/src/server.js, server/src/stream.js,
 * engine/simulation.py). Mirrors what the backend sends; mapping to frontend models lives in
 * backendAdapter.ts.
 *
 *   POST   /api/sim          {N, offset?, seed?, maxTimestep?, cellSize?, isReal?}  -> 201 CreateSimResponse
 *   POST   /api/sim/stream   {simID, tickRate?}                          -> 202/200 StartStreamResponse
 *   DELETE /api/sim/stream                                               -> 200 StopStreamResponse
 *   WS     /ws/sim/stream    one JSON SimFrame per engine tick (single client; newest connection wins)
 *
 * Grids are flattened row-major; dims = [rows, cols]; positions are [row, col], 0-based.
 */

export interface WireGrid {
  data: number[];
  dims: [number, number];
}

export type WireCell = [number, number];

export interface SimParams {
  N: number;
  offset?: number;
  seed?: number | null;
  maxTimestep?: number;
  /** Metres per cell (engine default 3). */
  cellSize?: number;
}

/** Body for POST /api/sim. `isReal` is sent for the planned real-data engine; today's server ignores it. */
export interface CreateSimRequest extends SimParams {
  isReal: boolean;
}

export interface CreateSimResponse {
  simID: string;
  params: Required<Omit<SimParams, 'seed'>> & { seed: number };
  /** Sim seconds per engine tick (the frames' clock). */
  tickSeconds?: number;
  hiker: { start: WireCell; end: WireCell };
  environment: {
    elevation: WireGrid;
    /** 1 = no, 2 = low, 3 = high camera interference (foliage). */
    canopy: WireGrid;
    /** 4 [x, y] corners, clockwise. */
    perimeter: [number, number][];
    /** Minutes to walk from the LKP to each cell. */
    travelTime?: WireGrid;
  };
}

export interface StartStreamResponse {
  status: 'started' | 'already_running';
  tick: number;
  tickRate?: number;
}

export interface StopStreamResponse {
  status: 'stopped' | 'not_running';
  simID?: string;
  tick?: number;
}

export interface WireDrone {
  id: string;
  pos: WireCell;
  laps?: number;
}

/** Frame v1 (engine/simulation.py → Simulation.frame). */
export interface SimFrame {
  v: number;
  simID: string;
  tick: number;
  maxTimestep: number;
  status: 'running' | 'finished' | 'stopped';
  elapsedMinutes?: number;
  hiker: { current: WireCell; position?: [number, number]; moving?: boolean };
  drones: WireDrone[];
  /** The engine's prior for the hiker's location: probability of a cell = data[i] / 100000 * max. */
  prior?: { data: number[]; dims: [number, number]; max: number };
  /** Travel-time radii (minutes from the LKP) of the 25/50/75/95% rings. */
  rings?: number[];
  /** How the prior rates the true hiker (evaluation only). */
  check?: { probability: number; massAbove: number; ring: number };
}

/** Sim seconds per engine tick, until a CreateSimResponse says otherwise (engine/simulation.py TICK_SECONDS). */
export const ENGINE_TICK_SEC = 6;

/** Prior levels are integers 0..PRIOR_LEVELS relative to the frame's max. */
export const PRIOR_LEVELS = 100_000;

export function isSimFrame(x: unknown): x is SimFrame {
  const o = x as SimFrame;
  return !!o && typeof o === 'object' && typeof o.simID === 'string' && typeof o.tick === 'number';
}
