/**
 * Turns backend payloads into the frontend's own models (TerrainGrid, Park, report, mission,
 * environment, simulation). This is the only place that knows both shapes.
 *
 * Axis convention: the engine sends [row, col]; the frontend uses {x: col, y: row}.
 */
import type { GridPoint, TerrainGrid, VegetationClass } from '../types/terrain';
import type { MissingPersonReport, Mission, Park } from '../types/mission';
import type { MissionEnvironment, SearchBlock, SimState } from '../types/simulation';
import type { FleetDrone } from '../types/drone';
import { PRIOR_LEVELS, type CreateSimResponse, type SimFrame, type WireCell, type WireGrid } from './contract';
import type { EngineFrame } from '../services/simulationService';
import { registerTerrain } from '../services/terrainService';
import { registerPark } from '../data/mockParks';
import { BLOCK, createEnvironment } from '../services/missionService';
import { createSimulation } from '../services/simulationService';

/** Engine canopy class (1 none / 2 low / 3 high interference) → frontend vegetation class + density. */
const CANOPY_TO_VEG: Record<number, { cls: VegetationClass; density: number }> = {
  1: { cls: 1, density: 0.18 }, // open ground / short grass
  2: { cls: 3, density: 0.62 }, // trees
  3: { cls: 4, density: 0.9 }, // dense forest
};

/** The engine's fake perimeter is grid units, not lat/lon, so test areas are anchored here. */
export const TEST_AREA_CENTER = { latitude: 42.7302, longitude: -73.6788 };

/** Fictional names for engine test subjects, picked by seed so a seed always gets the same one. */
const TEST_NAMES = ['Riley Parker', 'Jordan Hayes', 'Casey Morgan', 'Avery Collins', 'Quinn Ramirez', 'Taylor Brooks', 'Morgan Ellis', 'Drew Sullivan', 'Jamie Foster', 'Skyler Reed'];

export const toPoint = (c: WireCell | undefined | null): GridPoint | null => (Array.isArray(c) && c.length >= 2 ? { x: c[1], y: c[0] } : null);

function assertGrid(name: string, g: WireGrid): [number, number] {
  if (!g || !Array.isArray(g.data) || !Array.isArray(g.dims) || g.dims.length !== 2) throw new Error(`Backend ${name} is not {data, dims}`);
  const [rows, cols] = g.dims;
  if (g.data.length !== rows * cols) throw new Error(`Backend ${name}: data has ${g.data.length} values but dims are ${rows}×${cols}`);
  return [rows, cols];
}

export function gridFromBackend(parkId: string, created: CreateSimResponse, cellSizeM: number): TerrainGrid {
  const env = created.environment;
  const simID = created.simID;
  const [H, W] = assertGrid('elevation', env.elevation);
  const [ch, cw] = assertGrid('canopy', env.canopy);
  if (ch !== H || cw !== W) throw new Error(`Backend canopy dims ${ch}×${cw} do not match elevation ${H}×${W}`);
  const N = W * H;
  const elevation = Float32Array.from(env.elevation.data);
  const vegetation = new Uint8Array(N);
  const vegetationDensity = new Float32Array(N);
  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < N; i++) {
    const e = elevation[i];
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    const v = CANOPY_TO_VEG[env.canopy.data[i]] ?? CANOPY_TO_VEG[2];
    vegetation[i] = v.cls;
    vegetationDensity[i] = v.density;
  }
  const slope = new Float32Array(N);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const l = elevation[y * W + Math.max(0, x - 1)];
      const r = elevation[y * W + Math.min(W - 1, x + 1)];
      const u = elevation[Math.max(0, y - 1) * W + x];
      const d = elevation[Math.min(H - 1, y + 1) * W + x];
      slope[y * W + x] = (Math.atan(Math.hypot((r - l) / (2 * cellSizeM), (d - u) / (2 * cellSizeM))) * 180) / Math.PI;
    }

  const lkp = clampPoint(toPoint(created.hiker.start) ?? { x: W >> 1, y: H >> 1 }, W, H);
  // Drones stage where the engine says; older engines don't say, so stage a short walk from the
  // last-known point toward the middle of the area.
  const toward = { x: W / 2 - lkp.x, y: H / 2 - lkp.y };
  const len = Math.hypot(toward.x, toward.y) || 1;
  const step = Math.min(8, Math.max(2, Math.round(Math.min(W, H) * 0.06)));
  const engineBase = toPoint(created.base);
  const base = clampPoint(engineBase ?? { x: Math.round(lkp.x + (toward.x / len) * step), y: Math.round(lkp.y + (toward.y / len) * step) }, W, H);

  return {
    id: `backend:${simID}`,
    parkId,
    width: W,
    height: H,
    cellSizeM,
    elevation,
    slope,
    vegetation,
    vegetationDensity,
    water: new Uint8Array(N),
    trail: new Uint8Array(N),
    minElevation: minE,
    maxElevation: maxE,
    lakeLevel: minE - 1, // engine has no water yet
    treeline: maxE + 1000,
    snowline: maxE + 2000,
    origin: TEST_AREA_CENTER,
    anchor: lkp,
    landmarks: [
      { id: 'lkp', name: 'Last known point', type: 'trailhead', x: lkp.x, y: lkp.y },
      { id: 'base', name: 'Drone staging', type: 'ranger', x: base.x, y: base.y },
    ],
    trails: [],
    rivers: [],
  };
}

function clampPoint(p: GridPoint, W: number, H: number): GridPoint {
  return { x: Math.max(0, Math.min(W - 1, Math.round(p.x))), y: Math.max(0, Math.min(H - 1, Math.round(p.y))) };
}

export interface BackendSearchOptions {
  created: CreateSimResponse;
  isReal: boolean;
  cellSizeM: number;
  hoursMissing: number;
  missionId: string;
  drones: FleetDrone[];
}

export interface BackendSearch {
  park: Park;
  report: MissingPersonReport;
  mission: Mission;
  env: MissionEnvironment;
  sim: SimState;
}

/** Builds a complete, renderable search from a backend simulation. */
export function buildBackendSearch(o: BackendSearchOptions): BackendSearch {
  const short = o.created.simID.slice(0, 8);
  const parkId = `backend-${short}`;
  const reportId = `SIM-${short}`;
  // The engine echoes the cell size it built the terrain at; trust it over what was asked for
  const cellSizeM = o.created.params.cellSize ?? o.cellSizeM;
  const grid = gridFromBackend(parkId, o.created, cellSizeM);
  const span = Math.max(grid.width, grid.height) * cellSizeM;
  const park: Park = {
    id: parkId,
    name: `Engine test area ${short}`,
    shortName: `Test ${short}`,
    state: '—',
    center: TEST_AREA_CENTER,
    areaKm2: Math.round((grid.width * grid.height * cellSizeM * cellSizeM) / 1e6),
    profile: { base: grid.minElevation, relief: grid.maxElevation - grid.minElevation, ridge: 0, exponent: 1, valley: false, domes: 0, lakeFraction: 0, treeline: grid.treeline, snowline: grid.snowline, moisture: 0.5, rivers: 0 },
    names: { peaks: [], lake: '', trailhead: 'Last known point', ranger: 'Drone staging', overlook: '', camp: '', trails: [] },
  };
  registerPark(park);
  registerTerrain(parkId, reportId, grid);

  const report: MissingPersonReport = {
    id: reportId,
    name: TEST_NAMES[Math.abs(o.created.params.seed) % TEST_NAMES.length],
    age: 30,
    sex: 'X',
    heightCm: 175,
    parkId,
    lkp: TEST_AREA_CENTER,
    hoursMissing: o.hoursMissing,
    reportDelayH: 0.5,
    description: `Generated by the backend engine (${o.isReal ? 'real' : 'fake'} data, seed ${o.created.params.seed}). Grid ${grid.width}×${grid.height} at ${cellSizeM} m (${(span / 1000).toFixed(1)} km across).`,
    clothing: 'Not provided by the engine (test subject)',
    experience: 'Intermediate',
    activity: 'Engine-driven test scenario',
    priority: 'medium',
    status: 'active',
    medical: 'n/a',
    equipment: 'n/a',
    reportingParty: `Backend simulation ${o.created.simID}`,
    weather: { summary: 'Not provided by engine', tempC: 15, windKph: 8, precip: 'None', visibilityKm: 20 },
    hikingSpeedKmh: 4,
    terrainDifficulty: 'Moderate',
    vegetationDensity: 'Mixed',
    initialRadiusKm: span / 2000,
    responseWindowH: 12,
    missionId: o.missionId,
  };

  const mission: Mission = {
    id: o.missionId,
    missingPerson: report.name,
    park: park.name,
    parkId,
    reportId,
    lastKnownPosition: TEST_AREA_CENTER,
    timeLastSeen: new Date(Date.now() - o.hoursMissing * 3600_000).toISOString(),
    status: 'ready',
    priority: 'medium',
    dronesAssigned: o.drones.map((d) => d.id),
    createdAt: Date.now(),
    progress: 0,
  };

  const env = createEnvironment(mission, report, park);
  // Frames are on the engine's clock, not the local sim's
  if (o.created.tickSeconds) env.tickSec = o.created.tickSeconds;
  useEngineSearch(env, o.created);
  const sim = createSimulation(env, mission, o.drones, Date.now());
  // The engine owns the hiker's true position; at tick 0 that is the start (last known point).
  const truth = toPoint(o.created.hiker.start);
  if (truth) sim.hiker = clampPoint(truth, grid.width, grid.height);
  return { park, report, mission, env, sim };
}

/**
 * The engine's drones search its own area and blocks, so the environment uses them instead of the
 * ones createEnvironment derived locally (block indices and ids follow the same rule on both sides).
 */
function useEngineSearch(env: MissionEnvironment, created: CreateSimResponse) {
  const search = created.search;
  if (!search) return;
  const g = env.grid;
  const W = g.width;
  const [rows, cols] = assertGrid('searchArea', search.searchArea);
  if (rows !== g.height || cols !== W) throw new Error(`Backend searchArea dims ${rows}×${cols} do not match the terrain`);
  if (search.blockSize !== BLOCK) throw new Error(`Backend blocks are ${search.blockSize} cells; the app uses ${BLOCK}`);
  const area = Uint8Array.from(search.searchArea.data);
  const sectorOf = new Map(search.blocks.map((b) => [b.index, b.sector]));
  const blocks: SearchBlock[] = env.blocks.map((b) => {
    const cells: number[] = [];
    for (let y = b.by * BLOCK; y < Math.min(g.height, b.by * BLOCK + BLOCK); y++)
      for (let x = b.bx * BLOCK; x < Math.min(W, b.bx * BLOCK + BLOCK); x++) if (area[y * W + x]) cells.push(y * W + x);
    return { ...b, cells, sector: sectorOf.get(b.index) ?? b.sector };
  });
  env.searchArea = area;
  env.searchAreaCells = area.reduce((n, v) => n + v, 0);
  env.blocks = blocks;
  env.sectors = search.sectors;
}

/** Engine prior levels → row-major probabilities summing to 1 (null if missing or malformed). */
export function priorFromWire(prior: SimFrame['prior']): Float32Array | null {
  if (!prior || !Array.isArray(prior.data) || !Array.isArray(prior.dims)) return null;
  const [rows, cols] = prior.dims;
  if (prior.data.length !== rows * cols) return null;
  const p = new Float32Array(prior.data.length);
  let total = 0;
  for (let i = 0; i < p.length; i++) {
    p[i] = (prior.data[i] / PRIOR_LEVELS) * prior.max;
    total += p[i];
  }
  if (!(total > 0)) return null;
  for (let i = 0; i < p.length; i++) p[i] /= total;
  return p;
}

const rc = (p: [number, number]): GridPoint => ({ x: p[1], y: p[0] });

/** Engine frame → frontend coordinates (x = col, y = row; drone positions are continuous). */
export function frameFromWire(f: SimFrame): EngineFrame {
  const likelihood = f.likelihood && f.likelihood.data.length === f.likelihood.dims[0] * f.likelihood.dims[1] ? Float32Array.from(f.likelihood.data) : null;
  return {
    tick: f.tick,
    maxTimestep: f.maxTimestep,
    status: f.status,
    elapsedSec: typeof f.elapsedMinutes === 'number' ? f.elapsedMinutes * 60 : undefined,
    prior: priorFromWire(f.prior),
    likelihood,
    blockOwner: f.blockOwner,
    blockSearchCount: f.blockSearchCount,
    searched: f.searched,
    auctions: (f.auctions ?? []).map((a) => ({ ...a, center: rc(a.center) })),
    signals: (f.signals ?? []).map((s) => ({ ...rc(s.pos), id: s.id, droneId: s.droneId, confidence: s.confidence, tick: s.tick, isTrue: s.isTrue })),
    events: f.events,
    hiker: toPoint(f.hiker?.current),
    drones: (f.drones ?? []).flatMap((d) => {
      if (!Array.isArray(d.pos) || d.pos.length < 2) return [];
      return [{
        ...rc(d.pos),
        id: d.id,
        status: d.status,
        objective: d.objective,
        battery: d.battery,
        heading: d.heading,
        agl: d.agl,
        currentBlock: d.currentBlock,
        queue: d.queue,
        path: d.path?.map(([r, c, mode]) => ({ x: c, y: r, mode })),
        distanceM: d.distanceM,
        cellsSearched: d.cellsSearched,
        blocksCompleted: d.blocksCompleted,
        holdingSignalId: d.holdingSignalId,
      }];
    }),
  };
}
