import type { GridPoint } from './terrain';

export type DroneStatus =
  | 'standby'
  | 'preparing'
  | 'launching'
  | 'en_route'
  | 'searching'
  | 'returning'
  | 'charging'
  | 'low_battery'
  | 'maintenance';

/** Contract for live drone telemetry (what a real fleet feed must supply). */
export interface Drone {
  id: string;
  name: string;
  status: DroneStatus;
  battery: number; // 0..100
  x: number; // grid units (float)
  y: number;
  altitude: number; // meters MSL
  heading: number; // degrees, 0 = north, clockwise
  assignedCells: string[]; // search-cell ids, e.g. "C-0412"
}

export interface DroneSpec {
  manufacturer: string;
  model: string;
  airframe: 'Quadcopter' | 'Hexacopter' | 'VTOL fixed-wing';
  flightTimeMin: number;
  rangeKm: number;
  cruiseSpeedMs: number;
  maxWindMs: number;
  camera: string;
  thermal: string;
  sensors: string[];
  weightKg: number;
  costUsd: number;
  /** Ground footprint radius of the thermal sensor at nominal AGL. */
  footprintM: number;
  /** Probability of detection in open terrain (before vegetation losses). */
  basePod: number;
}

export interface FlightRecord {
  date: number;
  missionId: string;
  park: string;
  durationMin: number;
  distanceKm: number;
  coverageKm2: number;
  result: string;
}

export interface FleetDrone {
  id: string;
  name: string;
  callsign: string;
  color: string;
  spec: DroneSpec;
  baseStatus: DroneStatus;
  battery: number;
  batteryHealth: number; // % of design capacity
  firmware: string;
  totalFlightHours: number;
  totalDistanceKm: number;
  missionsFlown: number;
  lastMaintenance: number;
  homeBase: string;
  assignedMissionId: string | null;
  flightHistory: FlightRecord[];
  batteryHistory: { cycle: number; capacity: number; level: number }[];
  sensorPerformance: { detectionRate: number; falsePositiveRate: number; avgPod: number; thermalUptime: number };
}

export interface Waypoint extends GridPoint {
  mode: 'transit' | 'search' | 'return';
}

/** Simulation-side drone: the public `Drone` contract plus engine bookkeeping. */
export interface SimDrone extends Drone {
  color: string;
  model: string;
  prevX: number;
  prevY: number;
  agl: number;
  queue: number[]; // block indices won at auction, not yet started
  currentBlock: number; // -1 when none
  path: Waypoint[];
  trail: GridPoint[];
  objective: string;
  distanceM: number;
  cellsSearched: number;
  blocksCompleted: number;
  speedTransit: number; // cells per tick
  speedSearch: number; // cells per tick
  footprint: number; // cells
  basePod: number;
  flightTimeMin: number;
  launchTick: number;
  stateTicks: number;
  holdingSignalId: string | null;
  passId: number;
  fleetIndex: number;
  lowBatteryWarned: boolean;
}
