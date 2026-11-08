/**
 * terrainService — procedural mock terrain. Replace `getTerrain` with a loader that maps
 * real DEM + land-cover rasters onto `TerrainGrid` and the rest of the app is unchanged.
 */
import type { GridPoint, Landmark, LatLon, TerrainCell, TerrainGrid, TrailPath } from '../types/terrain';
import type { Park } from '../types/mission';
import type { MissionEnvironment, SimState } from '../types/simulation';
import { Rng, hashString } from '../lib/rng';
import { clamp, fbm, ridged, smoothstep } from '../lib/noise';
import { MinHeap } from '../lib/heap';

export const GRID_W = 160;
export const GRID_H = 112;
export const CELL_M = 60;

const cache = new Map<string, TerrainGrid>();

export function getTerrain(park: Park, seedKey: string, lkp: LatLon): TerrainGrid {
  const key = `${park.id}:${seedKey}`;
  let g = cache.get(key);
  if (!g) {
    g = generateTerrain(park, key, lkp);
    cache.set(key, g);
  }
  return g;
}

/**
 * Use an externally supplied grid (e.g. from the backend engine) for this park + key instead of
 * generating one. Every consumer of `getTerrain` then renders the supplied data.
 */
export function registerTerrain(parkId: string, seedKey: string, grid: TerrainGrid): void {
  cache.set(`${parkId}:${seedKey}`, grid);
}

const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

function generateTerrain(park: Park, key: string, lkpLatLon: LatLon): TerrainGrid {
  const W = GRID_W;
  const H = GRID_H;
  const N = W * H;
  const seed = hashString(key) % 100000;
  const rng = new Rng(seed + 1);
  const P = park.profile;

  // ---- Elevation -----------------------------------------------------------
  const e = new Float32Array(N);
  const ox = rng.range(0, 60);
  const oy = rng.range(0, 60);
  const vPhase = rng.range(0, Math.PI * 2);
  const vAmp = rng.range(0.08, 0.15);
  const tiltA = rng.range(0, Math.PI * 2);
  const domes = Array.from({ length: P.domes }, () => ({
    x: rng.range(0.15, 0.85) * W,
    y: rng.range(0.15, 0.85) * H,
    r: rng.range(5, 10),
    h: rng.range(0.22, 0.38),
  }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / W) * 3.4 + ox;
      const ny = (y / W) * 3.4 + oy;
      const wx = (fbm(nx * 0.5, ny * 0.5, seed + 11, 3) - 0.5) * 1.4;
      const wy = (fbm(nx * 0.5 + 9.2, ny * 0.5 + 3.1, seed + 13, 3) - 0.5) * 1.4;
      const base = fbm(nx + wx, ny + wy, seed, 6);
      const rid = ridged((nx + wx) * 0.85, (ny + wy) * 0.85, seed + 3, 6);
      let h = base * (1 - P.ridge) + rid * P.ridge;
      h += ((x / W - 0.5) * Math.cos(tiltA) + (y / H - 0.5) * Math.sin(tiltA)) * 0.35;
      if (P.valley) {
        const vy = H * (0.5 + vAmp * Math.sin((x / W) * Math.PI * 1.7 + vPhase));
        const dv = Math.abs(y - vy) / H;
        h -= 0.42 * (1 - smoothstep(0.0, 0.2, dv));
      }
      for (const d of domes) {
        const dd = ((x - d.x) ** 2 + (y - d.y) ** 2) / (d.r * d.r);
        h += d.h * Math.exp(-dd);
      }
      e[y * W + x] = h;
    }
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < N; i++) {
    if (e[i] < mn) mn = e[i];
    if (e[i] > mx) mx = e[i];
  }
  const elevation = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = Math.pow((e[i] - mn) / (mx - mn), P.exponent);
    e[i] = t;
    elevation[i] = P.base + t * P.relief;
  }

  // ---- Water: lakes from the lowest basins, rivers by steepest descent ---------
  const water = new Uint8Array(N);
  const sorted = Array.from(elevation).sort((a, b) => a - b);
  const lakeLevel = sorted[Math.floor(clamp(P.lakeFraction, 0, 0.3) * (N - 1))] + 0.01;
  for (let i = 0; i < N; i++) if (elevation[i] < lakeLevel) water[i] = 1;

  const rivers: GridPoint[][] = [];
  const sources: number[] = [];
  for (let attempt = 0; attempt < 400 && sources.length < P.rivers; attempt++) {
    const x = rng.int(10, W - 11);
    const y = rng.int(10, H - 11);
    const i = y * W + x;
    if (e[i] < 0.5 || water[i]) continue;
    if (sources.some((s) => Math.hypot((s % W) - x, Math.floor(s / W) - y) < 40)) continue;
    sources.push(i);
  }
  for (const src of sources) {
    const visited = new Set<number>();
    let cur = src;
    const pts: GridPoint[] = [];
    for (let step = 0; step < 320; step++) {
      visited.add(cur);
      const cx = cur % W;
      const cy = Math.floor(cur / W);
      pts.push({ x: cx + 0.5, y: cy + 0.5 });
      if (water[cur] === 1 || cx <= 0 || cy <= 0 || cx >= W - 1 || cy >= H - 1) break;
      water[cur] = 2;
      let best = -1;
      let bestE = Infinity;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (visited.has(j)) continue;
        const ev = elevation[j] + rng.range(0, 1.5);
        if (ev < bestE) {
          bestE = ev;
          best = j;
        }
      }
      if (best < 0) break;
      if (elevation[best] >= elevation[cur]) elevation[best] = elevation[cur] - 0.5;
      cur = best;
    }
    if (pts.length > 6) rivers.push(chaikin(pts, 2));
  }
  for (let i = 0; i < N; i++) if (water[i] === 2) elevation[i] -= 3;

  // ---- Slope -----------------------------------------------------------------
  const slope = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = elevation[y * W + Math.max(0, x - 1)];
      const r = elevation[y * W + Math.min(W - 1, x + 1)];
      const u = elevation[Math.max(0, y - 1) * W + x];
      const d = elevation[Math.min(H - 1, y + 1) * W + x];
      const gx = (r - l) / (2 * CELL_M);
      const gy = (d - u) / (2 * CELL_M);
      slope[y * W + x] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    }
  }

  // ---- Distance to water (BFS) ---------------------------------------------------
  const waterDist = new Uint8Array(N).fill(255);
  const q: number[] = [];
  for (let i = 0; i < N; i++)
    if (water[i]) {
      waterDist[i] = 0;
      q.push(i);
    }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const d = waterDist[i];
    if (d >= 10) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    for (const [dx, dy] of NEIGHBORS.slice(0, 4)) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (waterDist[j] > d + 1) {
        waterDist[j] = d + 1;
        q.push(j);
      }
    }
  }

  // ---- Vegetation ------------------------------------------------------------------
  const vegetation = new Uint8Array(N);
  const vegetationDensity = new Float32Array(N);
  const DENS = [0.02, 0.18, 0.42, 0.7, 0.92];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (water[i]) continue;
      const el = elevation[i];
      const s = slope[i];
      const nx = (x / W) * 5;
      const ny = (y / W) * 5;
      const moistNoise = fbm(nx + 20, ny + 4, seed + 77, 4);
      const detail = fbm(nx * 4 + 3, ny * 4 + 8, seed + 91, 3);
      const wd = waterDist[i];
      let moist = moistNoise * 0.75 + P.moisture * 0.3 + (wd < 5 ? (5 - wd) * 0.045 : 0) - e[i] * 0.12;
      moist += (detail - 0.5) * 0.22 - Math.max(0, s - 22) / 55;
      let cls: number;
      const snowJitter = (detail - 0.5) * 90;
      if (el > P.snowline + snowJitter) cls = 0;
      else if (el > P.treeline + snowJitter) cls = moist > 0.48 ? 1 : 0;
      else if (s > 40) cls = 0;
      else {
        cls = moist < 0.4 ? 1 : moist < 0.48 ? 2 : moist < 0.58 ? 3 : 4;
        if (el > P.treeline - 140 && cls > 2) cls = 2;
      }
      vegetation[i] = cls;
      vegetationDensity[i] = clamp(DENS[cls] + (detail - 0.5) * 0.18, 0, 1);
    }
  }

  // ---- Landmarks -----------------------------------------------------------------------
  const isDry = (i: number) => water[i] === 0;
  const idx = (x: number, y: number) => y * W + x;
  const findBest = (score: (x: number, y: number, i: number) => number, x0 = 3, x1 = W - 4, y0 = 3, y1 = H - 4) => {
    let best = -1;
    let bs = Infinity;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.floor(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.floor(x1)); x++) {
        const i = idx(x, y);
        const s = score(x, y, i);
        if (s < bs) {
          bs = s;
          best = i;
        }
      }
    return best < 0 ? { x: Math.floor(W / 2), y: Math.floor(H / 2) } : { x: best % W, y: Math.floor(best / W) };
  };

  const lkp = findBest(
    (x, y, i) => (isDry(i) && slope[i] < 26 && water[i] === 0 ? Math.hypot(x - W * 0.44, y - H * 0.52) : Infinity),
    W * 0.3,
    W * 0.6,
    H * 0.35,
    H * 0.7,
  );
  const trailhead = findBest(
    (x, y, i) => (isDry(i) && waterDist[i] > 1 ? e[i] * 2 + slope[i] / 25 + Math.hypot(x - W * 0.12, y - H * 0.82) / 40 : Infinity),
    5,
    W * 0.32,
    H * 0.6,
    H - 6,
  );
  const ranger = findBest(
    (x, y, i) => {
      const d = Math.hypot(x - trailhead.x, y - trailhead.y);
      return isDry(i) && d >= 3 && d <= 8 && waterDist[i] > 1 ? slope[i] + Math.abs(d - 5) : Infinity;
    },
    trailhead.x - 9,
    trailhead.x + 9,
    trailhead.y - 9,
    trailhead.y + 9,
  );
  const peaks: GridPoint[] = [];
  for (let k = 0; k < 3; k++) {
    const p = findBest((x, y, i) => (peaks.some((pk) => Math.hypot(pk.x - x, pk.y - y) < 32) ? Infinity : -elevation[i]), 4, W - 5, 4, H - 5);
    peaks.push(p);
  }
  const overlook = findBest(
    (x, y, i) => (isDry(i) && e[i] > 0.5 ? Math.abs(Math.hypot(x - lkp.x, y - lkp.y) - 26) + slope[i] / 10 : Infinity),
  );
  const camp = findBest((x, y, i) => {
    const d = Math.hypot(x - lkp.x, y - lkp.y);
    return isDry(i) && d > 16 && d < 42 && waterDist[i] >= 1 && waterDist[i] <= 4 ? slope[i] + Math.abs(d - 26) * 0.2 : Infinity;
  });

  // Largest lake (connected component) for a label.
  let lakePoint: GridPoint | null = null;
  {
    const seen = new Uint8Array(N);
    let bestSize = 0;
    for (let i = 0; i < N; i++) {
      if (water[i] !== 1 || seen[i]) continue;
      const comp: number[] = [i];
      seen[i] = 1;
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k];
        const cx = c % W;
        const cy = Math.floor(c / W);
        for (const [dx, dy] of NEIGHBORS.slice(0, 4)) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (water[j] === 1 && !seen[j]) {
            seen[j] = 1;
            comp.push(j);
          }
        }
      }
      if (comp.length > bestSize && comp.length > 12) {
        bestSize = comp.length;
        let sx = 0;
        let sy = 0;
        for (const c of comp) {
          sx += c % W;
          sy += Math.floor(c / W);
        }
        lakePoint = { x: sx / comp.length, y: sy / comp.length };
      }
    }
  }

  const n = park.names;
  const landmarks: Landmark[] = [
    { id: 'lm-th', name: n.trailhead, type: 'trailhead', x: trailhead.x + 0.5, y: trailhead.y + 0.5 },
    { id: 'lm-rs', name: n.ranger, type: 'ranger', x: ranger.x + 0.5, y: ranger.y + 0.5 },
    { id: 'lm-ov', name: n.overlook, type: 'overlook', x: overlook.x + 0.5, y: overlook.y + 0.5 },
    { id: 'lm-cp', name: n.camp, type: 'camp', x: camp.x + 0.5, y: camp.y + 0.5 },
    ...peaks.map((p, k) => ({ id: `lm-pk${k}`, name: n.peaks[k], type: 'peak' as const, x: p.x + 0.5, y: p.y + 0.5 })),
  ];
  if (lakePoint) landmarks.push({ id: 'lm-lk', name: n.lake, type: 'lake', x: lakePoint.x + 0.5, y: lakePoint.y + 0.5 });

  // ---- Trails (least-cost paths favoring gentle grades) ------------------------------
  const trail = new Uint8Array(N);
  const route = (pts: GridPoint[]) => {
    const out: number[] = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const seg = leastCostPath(W, H, elevation, slope, water, trail, idx(pts[k].x, pts[k].y), idx(pts[k + 1].x, pts[k + 1].y));
      out.push(...(k === 0 ? seg : seg.slice(1)));
    }
    for (const i of out) trail[i] = 1;
    return out;
  };
  const toTrail = (id: string, name: string, cells: number[]): TrailPath => {
    const raw = cells.filter((_, k) => k % 2 === 0 || k === cells.length - 1).map((i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 }));
    let len = 0;
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1];
      const b = cells[k];
      len += Math.hypot((a % W) - (b % W), Math.floor(a / W) - Math.floor(b / W)) * CELL_M;
    }
    return { id, name, points: chaikin(raw, 3), lengthKm: +(len / 1000).toFixed(1) };
  };
  const t1 = route([trailhead, lkp, overlook]);
  const t2 = route([ranger, camp, lakePoint ? { x: Math.round(lakePoint.x), y: Math.round(lakePoint.y) } : peaks[1]].map(nearestDry(W, H, water)));
  const t3 = route([camp, peaks[0]].map(nearestDry(W, H, water)));
  const trails: TrailPath[] = [toTrail('tr-1', n.trails[0], t1), toTrail('tr-2', n.trails[1], t2), toTrail('tr-3', n.trails[2], t3)];

  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < N; i++) {
    if (elevation[i] < minE) minE = elevation[i];
    if (elevation[i] > maxE) maxE = elevation[i];
  }

  return {
    id: key,
    parkId: park.id,
    width: W,
    height: H,
    cellSizeM: CELL_M,
    elevation,
    slope,
    vegetation,
    vegetationDensity,
    water,
    trail,
    minElevation: minE,
    maxElevation: maxE,
    lakeLevel,
    treeline: P.treeline,
    snowline: P.snowline,
    origin: lkpLatLon,
    anchor: { x: lkp.x, y: lkp.y },
    landmarks,
    trails,
    rivers,
  };
}

function nearestDry(W: number, H: number, water: Uint8Array) {
  return (p: GridPoint): GridPoint => {
    for (let r = 0; r < 12; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.min(W - 1, Math.max(0, p.x + dx));
          const y = Math.min(H - 1, Math.max(0, p.y + dy));
          if (!water[y * W + x]) return { x, y };
        }
    return p;
  };
}

function leastCostPath(W: number, H: number, elev: Float32Array, slope: Float32Array, water: Uint8Array, trail: Uint8Array, from: number, to: number): number[] {
  const N = W * H;
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(from, 0);
  const tx = to % W;
  const ty = Math.floor(to / W);
  const closed = new Uint8Array(N);
  while (heap.size) {
    const [i] = heap.pop()!;
    if (i === to) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const d = dist[i];
    const x = i % W;
    const y = Math.floor(i / W);
    for (const [dx, dy, len] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const grade = Math.abs(elev[j] - elev[i]) / (len * CELL_M);
      let c = len * (1 + (grade / 0.12) ** 2 * 2 + slope[j] / 60);
      if (water[j] === 1) c += 400;
      else if (water[j] === 2) c += 6;
      if (trail[j]) c *= 0.55;
      const nd = d + c;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(j, nd + Math.hypot(nx - tx, ny - ty) * 0.9);
      }
    }
  }
  const path: number[] = [];
  for (let c = to; c >= 0; c = prev[c]) {
    path.push(c);
    if (c === from) break;
  }
  return path.reverse();
}

export function chaikin(pts: GridPoint[], iterations: number): GridPoint[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) return p;
    const out: GridPoint[] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k];
      const b = p[k + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// ---- Geo helpers ---------------------------------------------------------------------------
export function cellToLatLon(grid: TerrainGrid, x: number, y: number): LatLon {
  const lat = grid.origin.latitude - ((y - grid.anchor.y - 0.5) * grid.cellSizeM) / 111320;
  const lon = grid.origin.longitude + ((x - grid.anchor.x - 0.5) * grid.cellSizeM) / (111320 * Math.cos((grid.origin.latitude * Math.PI) / 180));
  return { latitude: lat, longitude: lon };
}

export function toblerKmh(slopeDeg: number, downhill = false): number {
  const s = Math.tan((slopeDeg * Math.PI) / 180) * (downhill ? -1 : 1);
  return 6 * Math.exp(-3.5 * Math.abs(s + 0.05));
}

/** Build the per-cell contract view combining terrain + (optional) simulation state. */
export function getCellView(grid: TerrainGrid, x: number, y: number, env?: MissionEnvironment | null, sim?: SimState | null, distribution?: Float32Array | null): TerrainCell {
  const i = y * grid.width + x;
  const st = sim?.cellStatus[i] ?? 0;
  const owner = sim ? sim.owner[i] : -1;
  return {
    x,
    y,
    elevation: grid.elevation[i],
    vegetation: grid.vegetation[i],
    vegetationDensity: grid.vegetationDensity[i],
    probability: distribution ? distribution[i] : sim ? sim.probability[i] : 0,
    searchStatus: st === 2 ? 'searched' : st === 1 ? 'assigned' : 'unsearched',
    assignedDroneId: owner >= 0 && sim ? sim.drones[owner]?.id ?? null : null,
  };
}
