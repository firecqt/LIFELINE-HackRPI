/**
 * Wire contract with the LIFELINE backend (server/src/server.js, server/src/stream.js,
 * engine/simulation.py). Mirrors what the backend sends; mapping to frontend models lives in
 * backendAdapter.ts.
 *
 *   POST   /api/sim          {N, offset?, seed?, maxTimestep?, cellSize?, isReal?}  -> 201 CreateSimResponse
 *   POST   /api/sim/stream   {simID, tickRate?}                          -> 202/200 StartStreamResponse
 *   DELETE /api/sim/stream                                               -> 200 StopStreamResponse
 *   POST   /api/sim/stream/signal {simID, signalId, action}             -> 200 {status} (409 if not streaming)
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

/** A drone the engine should fly (specs from the fleet). */
export interface WireDroneSpec {
  id: string;
  cruiseSpeedMs: number;
  footprintM: number;
  /** Probability of detection in open terrain, 0..1. */
  basePod: number;
  flightTimeMin: number;
  battery?: number;
}

/** Body for POST /api/sim. `isReal` is sent for the planned real-data engine; today's server ignores it. */
export interface CreateSimRequest extends SimParams {
  isReal: boolean;
  drones?: WireDroneSpec[];
}

/** Search geometry the engine's drones work in: 4×4-cell blocks (index = by * blocksW + bx). */
export interface WireSearch {
  blockSize: number;
  blocksW: number;
  blocksH: number;
  sectors: string[];
  /** Blocks with at least one search-area cell. */
  blocks: { index: number; id: string; sector: string }[];
  /** 1 = inside the search area. */
  searchArea: WireGrid;
}

export interface CreateSimResponse {
  simID: string;
  params: Required<Omit<SimParams, 'seed'>> & { seed: number };
  /** Sim seconds per engine tick (the frames' clock). */
  tickSeconds?: number;
  hiker: { start: WireCell; end: WireCell };
  /** Drone staging cell. */
  base?: WireCell;
  search?: WireSearch;
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

export type DroneStatusWire = 'standby' | 'preparing' | 'launching' | 'en_route' | 'searching' | 'returning' | 'charging' | 'low_battery';

/** A drone in a frame; pos and path are continuous [row, col] (cell centres at +0.5). */
export interface WireDrone {
  id: string;
  pos: [number, number];
  status?: DroneStatusWire;
  objective?: string;
  battery?: number;
  heading?: number;
  agl?: number;
  currentBlock?: number;
  queue?: number[];
  path?: [number, number, 'transit' | 'search' | 'return'][];
  distanceM?: number;
  cellsSearched?: number;
  blocksCompleted?: number;
  holdingSignalId?: string | null;
}

export interface WireBid {
  droneId: string;
  horizontalM: number;
  verticalM: number;
  batteryPct: number;
  expectedValue: number;
  load: number;
  score: number;
}

export interface WireAuctionRound {
  tick: number;
  blockIndex: number;
  blockId: string;
  center: [number, number];
  expectedValue: number;
  candidates: { blockId: string; blockIndex: number; value: number }[];
  bids: WireBid[];
  winnerId: string | null;
}

export interface WireSignal {
  id: string;
  droneId: string;
  pos: [number, number];
  confidence: number;
  tick: number;
  isTrue: boolean;
  status: 'pending' | 'released' | 'confirmed';
}

export interface WireEvent {
  kind: 'launch' | 'landed' | 'low_battery' | 'block_complete' | 'sector_complete' | 'detection';
  tick: number;
  droneId?: string;
  blockId?: string | null;
  sector?: string | null;
  signalId?: string;
  battery?: number;
}

export type SignalAction = 'dispatch' | 'dismiss' | 'false_positive' | 'not_subject' | 'confirmed';

/** Frame v1 (engine/simulation.py → Simulation.frame). */
export interface SimFrame {
  v: number;
  simID: string;
  tick: number;
  maxTimestep: number;
  status: 'running' | 'finished' | 'stopped' | 'located';
  elapsedMinutes?: number;
  hiker: { current: WireCell; position?: [number, number]; moving?: boolean };
  drones: WireDrone[];
  /** The engine's prior for the hiker's location: probability of a cell = data[i] / 100000 * max. */
  prior?: { data: number[]; dims: [number, number]; max: number };
  /** Travel-time radii (minutes from the LKP) of the 25/50/75/95% rings. */
  rings?: number[];
  /** How the prior rates the true hiker (evaluation only). */
  check?: { probability: number; massAbove: number; ring: number };
  /** Chance the hiker was missed in each cell; posterior = prior × likelihood, renormalised. */
  likelihood?: WireGrid;
  /** Per block: index of the drone working it, or -1. */
  blockOwner?: number[];
  /** Per block: completed sweeps. */
  blockSearchCount?: number[];
  /** Cells swept since the last frame: [flat index, drone index]. */
  searched?: [number, number][];
  /** Auction rounds since the last frame. */
  auctions?: WireAuctionRound[];
  /** Every signal raised so far. */
  signals?: WireSignal[];
  /** Since the last frame. */
  events?: WireEvent[];
}

/** Sim seconds per engine tick, until a CreateSimResponse says otherwise (engine/simulation.py TICK_SECONDS). */
export const ENGINE_TICK_SEC = 6;

/** Prior levels are integers 0..PRIOR_LEVELS relative to the frame's max. */
export const PRIOR_LEVELS = 100_000;

export function isSimFrame(x: unknown): x is SimFrame {
  const o = x as SimFrame;
  return !!o && typeof o === 'object' && typeof o.simID === 'string' && typeof o.tick === 'number';
}
