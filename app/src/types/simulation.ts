import type { SimDrone } from './drone';
import type { ProbabilitySnapshot, ProbabilityStats } from './probability';
import type { GridPoint, TerrainGrid } from './terrain';
import type { MissingPersonReport, Park } from './mission';
import type { Rng } from '../lib/rng';

export type SimStatus = 'ready' | 'running' | 'paused' | 'complete';
export type SimOutcome = 'located' | 'suspended' | 'stood_down' | null;

export type LogType = 'system' | 'drone' | 'auction' | 'search' | 'probability' | 'detection' | 'warning' | 'ranger';

export interface LogEntry {
  id: number;
  t: number; // sim seconds
  clock: string;
  type: LogType;
  message: string;
  droneId?: string;
}

/** A 4x4-cell search block: the unit the drone auction allocates. */
export interface SearchBlock {
  index: number;
  id: string; // "C-0412"
  bx: number;
  by: number;
  cells: number[]; // grid indices inside the search area
  sector: string; // A..F
  center: GridPoint;
  meanElevation: number;
}

export interface Bid {
  droneId: string;
  color: string;
  horizontalM: number;
  verticalM: number;
  batteryPct: number;
  expectedValue: number;
  load: number;
  score: number;
}

export interface AuctionRound {
  id: number;
  tick: number;
  clock: string;
  blockIndex: number;
  blockId: string;
  center: GridPoint;
  expectedValue: number;
  candidates: { blockId: string; blockIndex: number; value: number }[];
  bids: Bid[];
  winnerId: string | null;
}

export interface AuctionLogEntry {
  id: number;
  clock: string;
  message: string;
  kind: 'bid' | 'win' | 'update';
  droneId?: string;
}

/**
 * pending → (ranger dispatches) verifying → (team arrives) on_scene → (team confirms) one of
 * confirmed | not_subject | false_positive. A ranger may also dismiss a pending/verifying signal.
 */
export type SignalStatus = 'pending' | 'verifying' | 'on_scene' | 'confirmed' | 'not_subject' | 'false_positive' | 'dismissed';

/** What the ground team decided on scene. */
export type FieldVerdict = 'subject' | 'other_person' | 'not_human';
export type SubjectCondition = 'uninjured' | 'minor_injuries' | 'needs_evacuation';

/** The ground team's confirmation, filed from the Ground Team view. */
export interface FieldReport {
  verdict: FieldVerdict;
  condition: SubjectCondition | null;
  /** Identity checks the team ticked (e.g. "Responds to name"). */
  checks: string[];
  notes: string;
  tick: number;
  clock: string;
}

export interface DetectionSignal {
  id: string;
  droneId: string;
  x: number;
  y: number;
  confidence: number;
  tick: number;
  clock: string;
  status: SignalStatus;
  /** Ground truth known only to the mock engine; never shown to the user before verification. */
  isTrue: boolean;
  etaTick: number | null;
  /** Tick the ground team was dispatched (for ETA progress). */
  dispatchTick: number | null;
  sensor: string;
  fieldReport: FieldReport | null;
}

export type SimEventKind =
  | 'detection'
  | 'low_battery'
  | 'sector_complete'
  | 'priority'
  | 'located'
  | 'false_positive'
  | 'ground_on_scene'
  | 'launch'
  | 'returned'
  | 'mission_complete';

export interface SimEvent {
  kind: SimEventKind;
  severity: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  x?: number;
  y?: number;
  droneId?: string;
  signalId?: string;
  voice?: string;
}

export interface CoveragePoint {
  minute: number;
  coverage: number;
  unexplored: number;
  pos: number;
  peak: number;
}

export interface SimStats extends ProbabilityStats {
  coverage: number;
  cellsSearched: number;
  searchAreaCells: number;
  blocksSearched: number;
  totalBlocks: number;
  distanceKm: number;
  dronesAirborne: number;
  travelHours: number;
}

/** Entire mutable simulation state for one mission. Typed arrays are mutated in place; the
 *  wrapper object is replaced each step (with `version` bumped) so React can react. */
export interface SimState {
  missionId: string;
  version: number;
  seed: number;
  tick: number;
  elapsedSec: number;
  status: SimStatus;
  outcome: SimOutcome;
  speed: number;
  clockBase: number; // wall-clock ms at mission start (sim clock origin)
  drones: SimDrone[];
  owner: Int8Array; // per cell drone index or -1
  cellStatus: Uint8Array; // 0 unsearched, 1 assigned, 2 searched
  lastVisit: Int32Array;
  likelihood: Float32Array; // product of (1 - POD) non-detection likelihoods
  prior: Float32Array;
  probability: Float32Array; // normalized posterior
  blockOwner: Int8Array;
  blockSearchCount: Uint16Array;
  hiker: GridPoint; // hidden ground truth
  stats: SimStats;
  snapshots: ProbabilitySnapshot[];
  coverageHistory: CoveragePoint[];
  log: LogEntry[];
  auctionLog: AuctionLogEntry[];
  auctions: AuctionRound[];
  signals: DetectionSignal[];
  sectorsComplete: string[];
  priorityAlerted: boolean;
  events: SimEvent[];
  rng: Rng;
  logSeq: number;
  passSeq: number;
  auctionSeq: number;
  /** Mobile hours used for the current prior (drives the travel-range isochrone). */
  mobileHours: number;
}

export interface MissionEnvironment {
  missionId: string;
  report: MissingPersonReport;
  park: Park;
  grid: TerrainGrid;
  lkp: GridPoint;
  base: GridPoint;
  travelTime: Float32Array; // hours from LKP (Tobler)
  behavior: Float32Array; // lost-person behavior weights
  searchArea: Uint8Array;
  searchAreaCells: number;
  pod: Float32Array; // per-cell nominal detection probability (sensor x vegetation)
  blocks: SearchBlock[];
  blocksW: number;
  blocksH: number;
  sectors: string[];
  hoursMissingAtStart: number;
  /** Scales Tobler mobile time so the prior's support matches the clamped search area. */
  mobileScale: number;
  /** Sim seconds per tick when the backend engine sets the clock (default TICK_SEC). */
  tickSec?: number;
}
