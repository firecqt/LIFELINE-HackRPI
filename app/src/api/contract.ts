/**
 * Wire contract with the LIFELINE backend (server/src/server.js, server/src/stream.js,
 * engine/simulation.py). Mirrors what the backend sends; mapping to frontend models lives in
 * backendAdapter.ts.
 *
 *   POST   /api/sim          {N, offset?, seed?, maxTimestep?, isReal?}  -> 201 CreateSimResponse
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
}

/** Body for POST /api/sim. `isReal` is sent for the planned real-data engine; today's server ignores it. */
export interface CreateSimRequest extends SimParams {
  isReal: boolean;
}

export interface CreateSimResponse {
  simID: string;
  params: Required<Omit<SimParams, 'seed'>> & { seed: number };
  hiker: { start: WireCell; end: WireCell };
  environment: {
    elevation: WireGrid;
    /** 1 = no, 2 = low, 3 = high camera interference (foliage). */
    canopy: WireGrid;
    /** 4 [x, y] corners, clockwise. */
    perimeter: [number, number][];
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
  hiker: { current: WireCell };
  drones: WireDrone[];
}

export function isSimFrame(x: unknown): x is SimFrame {
  const o = x as SimFrame;
  return !!o && typeof o === 'object' && typeof o.simID === 'string' && typeof o.tick === 'number';
}
