import type { LatLon } from './terrain';

export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type ExperienceLevel = 'Novice' | 'Intermediate' | 'Experienced' | 'Expert';
export type ReportStatus = 'open' | 'active' | 'resolved';

export type MissionStatus =
  | 'initializing'
  | 'ready'
  | 'active'
  | 'high_priority'
  | 'paused'
  | 'detection'
  | 'verifying'
  | 'located'
  | 'suspended'
  | 'stood_down';

export interface TerrainProfile {
  base: number; // m
  relief: number; // m
  ridge: number; // 0..1 ridged-noise weight
  exponent: number;
  valley: boolean;
  domes: number;
  lakeFraction: number; // share of lowest cells that become lakes
  treeline: number;
  snowline: number;
  moisture: number;
  rivers: number;
}

export interface Park {
  id: string;
  name: string;
  shortName: string;
  state: string;
  center: LatLon;
  areaKm2: number;
  profile: TerrainProfile;
  names: {
    peaks: string[];
    lake: string;
    trailhead: string;
    ranger: string;
    overlook: string;
    camp: string;
    trails: string[];
  };
}

export interface MissingPersonReport {
  id: string; // incident id
  name: string;
  age: number;
  sex: 'F' | 'M' | 'X';
  heightCm: number;
  parkId: string;
  lkp: LatLon;
  hoursMissing: number; // at app load
  reportDelayH: number; // hours between last seen and report
  description: string;
  clothing: string;
  experience: ExperienceLevel;
  activity: string;
  priority: Priority;
  status: ReportStatus;
  medical: string;
  equipment: string;
  reportingParty: string;
  weather: { summary: string; tempC: number; windKph: number; precip: string; visibilityKm: number };
  hikingSpeedKmh: number;
  terrainDifficulty: 'Low' | 'Moderate' | 'High' | 'Extreme';
  vegetationDensity: 'Sparse' | 'Mixed' | 'Dense';
  initialRadiusKm: number;
  responseWindowH: number;
  missionId: string | null;
}

/** Contract for a mission record (spec §17). */
export interface Mission {
  id: string;
  missingPerson: string;
  park: string;
  parkId: string;
  reportId: string;
  lastKnownPosition: LatLon;
  timeLastSeen: string; // ISO
  status: MissionStatus;
  priority: Priority;
  dronesAssigned: string[];
  createdAt: number;
  /** Mock progress used until a live session exists. */
  progress: number;
}

export interface HistoricalMission {
  id: string;
  missingPerson: string;
  age: number;
  parkId: string;
  park: string;
  date: number;
  durationMin: number;
  drones: number;
  coverage: number;
  outcome: 'Located — alive' | 'Located — injured' | 'Self-rescued' | 'Located by ground team' | 'Suspended';
  detectionMin: number | null;
  areaKm2: number;
  summary: string;
  series: { minute: number; coverage: number; unexplored: number; peak: number; pos: number }[];
  droneDistances: { id: string; km: number }[];
  efficiency: { minute: number; massPerKm: number }[];
}
