/**
 * Terrain contract. A real elevation / land-cover pipeline only needs to produce a
 * `TerrainGrid`; every renderer consumes this structure and never generates data itself.
 */
export type VegetationClass = 0 | 1 | 2 | 3 | 4;

export const VEGETATION_LABELS = ['No vegetation', 'Short grass', 'Light vegetation', 'Trees', 'Dense forest'] as const;

export type SearchStatus = 'unsearched' | 'assigned' | 'searched';

/** Per-cell view used by tooltips, inspectors and the backend contract. */
export interface TerrainCell {
  x: number;
  y: number;
  elevation: number;
  vegetation: number;
  vegetationDensity: number;
  probability: number;
  searchStatus: SearchStatus;
  assignedDroneId: string | null;
}

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

export type LandmarkType = 'peak' | 'lake' | 'trailhead' | 'ranger' | 'overlook' | 'camp';

export interface Landmark {
  id: string;
  name: string;
  type: LandmarkType;
  x: number;
  y: number;
}

export interface TrailPath {
  id: string;
  name: string;
  /** Smoothed polyline in world (cell) units. */
  points: GridPoint[];
  lengthKm: number;
}

/** Dense, row-major (index = y * width + x) terrain matrix. */
export interface TerrainGrid {
  id: string;
  parkId: string;
  width: number;
  height: number;
  cellSizeM: number;
  elevation: Float32Array;
  slope: Float32Array; // degrees
  vegetation: Uint8Array; // VegetationClass
  vegetationDensity: Float32Array; // 0..1
  water: Uint8Array; // 0 none, 1 lake, 2 river
  trail: Uint8Array; // 1 if a trail crosses the cell
  minElevation: number;
  maxElevation: number;
  lakeLevel: number; // elevation below which pixels render as open water
  treeline: number;
  snowline: number;
  /** Geographic anchor: `anchor` cell sits at `origin` lat/lon. */
  origin: LatLon;
  anchor: GridPoint;
  landmarks: Landmark[];
  trails: TrailPath[];
  rivers: GridPoint[][];
}

export type TerrainViewMode = 'terrain' | 'elevation' | 'vegetation' | 'probability' | 'slope';

export interface MapOverlays {
  lkp: boolean;
  estimatedLocation: boolean;
  drones: boolean;
  flightPaths: boolean;
  droneBoundaries: boolean;
  heatmap: boolean;
  searchArea: boolean;
  travelRange: boolean;
  ownership: boolean;
  trails: boolean;
  grid: boolean;
}
