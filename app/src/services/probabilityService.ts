/**
 * probabilityService — SIMULATED probability model.
 *
 * 1. Travel time from the LKP is computed with Dijkstra over the grid, using Tobler's
 *    hiking function v = 6·exp(-3.5·|tanθ + 0.05|) km/h scaled by the subject's speed,
 *    vegetation drag and trail bonus. Lakes are impassable, rivers slow.
 * 2. A time-dependent prior spreads mass across cells reachable within the subject's
 *    estimated mobile time, weighted by simple lost-person behavior heuristics.
 * 3. Searches multiply a per-cell non-detection likelihood L(c) *= (1 − POD(c)).
 *    Posterior p(c) ∝ prior_t(c) · L(c), renormalized every step.
 *
 * This is an illustrative model for demonstration, not a validated predictive system.
 */
import type { GridPoint, TerrainGrid } from '../types/terrain';
import type { ProbabilitySnapshot, ProbabilityStats } from '../types/probability';
import { MinHeap } from '../lib/heap';
import { smoothstep } from '../lib/noise';

const VEG_SPEED = [0.8, 0.97, 0.85, 0.7, 0.5];

/**
 * Least walking time (hours) between `lkp` and every cell (Dijkstra + Tobler). With `reverse`,
 * returns the time to walk from each cell *to* `lkp` (Tobler is asymmetric up/downhill).
 */
export function computeTravelTime(grid: TerrainGrid, lkp: GridPoint, hikingSpeedKmh: number, reverse = false): Float32Array {
  const { width: W, height: H, elevation, water, vegetation, trail, cellSizeM } = grid;
  const N = W * H;
  const T = new Float32Array(N).fill(Infinity);
  const heap = new MinHeap();
  const start = lkp.y * W + lkp.x;
  T[start] = 0;
  heap.push(start, 0);
  const factor = hikingSpeedKmh / 5.04;
  while (heap.size) {
    const [i, t] = heap.pop()!;
    if (t > T[i]) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (water[j] === 1) continue;
        const dist = (dx && dy ? Math.SQRT2 : 1) * cellSizeM;
        // Forward: walk i → j. Reverse: the hiker walks j → i, arriving in cell i.
        const to = reverse ? i : j;
        const s = (reverse ? elevation[i] - elevation[j] : elevation[j] - elevation[i]) / dist;
        let v = 6 * Math.exp(-3.5 * Math.abs(s + 0.05)) * factor * VEG_SPEED[vegetation[to]];
        if (trail[to]) v *= 1.25;
        if (water[to] === 2) v *= 0.3;
        const nt = t + dist / 1000 / Math.max(0.05, v);
        if (nt < T[j]) {
          T[j] = nt;
          // Push the stored (float32-rounded) value: pushing the float64 `nt` can make the
          // stale-entry check `t > T[i]` true for the live entry and drop the cell entirely.
          heap.push(j, T[j]);
        }
      }
  }
  return T;
}

/** Hours of effective movement for a subject missing `hours` (lost hikers stop, rest, backtrack). */
export function hikerMobileHours(hours: number): number {
  return Math.min(1.6, 0.15 + 0.21 * hours);
}

/** Static lost-person behavior weights (trail affinity, drainage following, downhill bias). */
export function computeBehavior(grid: TerrainGrid, lkp: GridPoint): Float32Array {
  const { width: W, height: H, elevation, water, trail, slope, vegetation } = grid;
  const N = W * H;
  const out = new Float32Array(N);
  const lkpElev = elevation[lkp.y * W + lkp.x];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (water[i] === 1) continue;
      let w = 1;
      let nearTrail = false;
      let nearRiver = false;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (trail[j] && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) nearTrail = true;
          if (water[j] === 2) nearRiver = true;
        }
      if (nearTrail) w *= 1.7;
      if (nearRiver) w *= 1.35;
      w *= elevation[i] < lkpElev ? 1.15 : 0.9;
      if (slope[i] > 35) w *= 0.55;
      if (vegetation[i] === 4) w *= 1.1;
      out[i] = w;
    }
  return out;
}

/** Time-dependent prior. Writes normalized values into `out` and returns the mobile hours used. */
export function computePrior(travel: Float32Array, behavior: Float32Array, hoursMissing: number, out: Float32Array, scale = 1): number {
  const tm = hikerMobileHours(hoursMissing) * scale;
  let sum = 0;
  for (let i = 0; i < travel.length; i++) {
    const T = travel[i];
    if (!(T < Infinity) || behavior[i] === 0) {
      out[i] = 0;
      continue;
    }
    const r = T / tm;
    if (r > 1.25) {
      out[i] = 0;
      continue;
    }
    const f = (0.2 + 1.5 * Math.pow(r, 0.8)) * Math.exp(-2.4 * r) * (1 - smoothstep(0.9, 1.25, r)) * behavior[i];
    out[i] = f;
    sum += f;
  }
  if (sum > 0) for (let i = 0; i < out.length; i++) out[i] /= sum;
  return tm;
}

export function computePosterior(prior: Float32Array, likelihood: Float32Array, out: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < prior.length; i++) {
    const v = prior[i] * likelihood[i];
    out[i] = v;
    sum += v;
  }
  if (sum > 0) for (let i = 0; i < out.length; i++) out[i] /= sum;
}

export function computeStats(prior: Float32Array, likelihood: Float32Array, p: Float32Array, cellStatus: Uint8Array, W: number): ProbabilityStats {
  let peakI = 0;
  let peak = 0;
  let searched = 0;
  let cleared = 0;
  let mx = 0;
  let my = 0;
  let ent = 0;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (v > peak) {
      peak = v;
      peakI = i;
    }
    if (cellStatus[i] === 2) searched += v;
    cleared += prior[i] * (1 - likelihood[i]);
    const x = (i % W) + 0.5;
    const y = ((i / W) | 0) + 0.5;
    mx += v * x;
    my += v * y;
    if (v > 0) ent -= v * Math.log(v);
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (!v) continue;
    const dx = (i % W) + 0.5 - mx;
    const dy = ((i / W) | 0) + 0.5 - my;
    sxx += v * dx * dx;
    syy += v * dy * dy;
    sxy += v * dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    peak: { x: peakI % W, y: (peakI / W) | 0, probability: peak },
    searchedMass: searched,
    unexploredMass: 1 - searched,
    cumulativePos: Math.min(1, Math.max(0, cleared)),
    mean: { x: mx, y: my },
    ellipse: { rx: Math.sqrt(l1), ry: Math.sqrt(l2), angle },
    entropy: ent,
  };
}

export function makeSnapshot(p: Float32Array, W: number, H: number, elapsedSec: number, stats: ProbabilityStats, coverage: number): ProbabilitySnapshot {
  return {
    timestamp: elapsedSec,
    minutes: elapsedSec / 60,
    width: W,
    height: H,
    distribution: new Float32Array(p),
    highestProbabilityCell: { ...stats.peak },
    searchedMass: stats.searchedMass,
    coverage,
  };
}

// ---- Adapters for the backend contract (number[][] ⇄ Float32Array) ------------------------
export function toProbabilityMatrix(p: Float32Array, W: number, H: number): number[][] {
  return Array.from({ length: H }, (_, y) => Array.from(p.subarray(y * W, y * W + W)));
}

export function fromProbabilityMatrix(m: number[][]): Float32Array {
  const H = m.length;
  const W = m[0]?.length ?? 0;
  const out = new Float32Array(W * H);
  let sum = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      out[y * W + x] = m[y][x];
      sum += m[y][x];
    }
  if (sum > 0 && Math.abs(sum - 1) > 1e-6) for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/** Nominal probability of detection for a cell given sensor quality and canopy. */
export function cellPod(basePod: number, vegetationDensity: number): number {
  return basePod * (1 - 0.72 * vegetationDensity);
}

export interface RecoveryCorridor {
  /** Normalized (Σ = 1) likelihood that the hiker's route passed through each cell. */
  distribution: Float32Array;
  /** Fastest walking route from the LKP to the found position, in grid units. */
  route: GridPoint[];
  routeKm: number;
  /** Walking time along the fastest route, in hours. */
  routeHours: number;
}

/**
 * Reconstructs how the hiker most likely travelled from the last known position (LKP) to where
 * they were found. A cell's weight falls off with the detour it adds to the fastest walk:
 *   detour(c) = T(LKP → c) + T(c → found) − T(LKP → found),   weight = exp(−detour / τ).
 * Illustrative only: real hikers wander, stop and backtrack.
 */
export function computeRecoveryCorridor(grid: TerrainGrid, travelFromLkp: Float32Array, lkp: GridPoint, found: GridPoint, hikingSpeedKmh: number): RecoveryCorridor {
  const W = grid.width;
  const N = travelFromLkp.length;
  const fi = found.y * W + found.x;
  const toFound = computeTravelTime(grid, found, hikingSpeedKmh, true);
  const tMin = Math.min(travelFromLkp[fi], toFound[lkp.y * W + lkp.x]);
  const tau = Math.max(0.05, 0.12 * (Number.isFinite(tMin) ? tMin : 1));
  const dist = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const detour = travelFromLkp[i] + toFound[i] - tMin;
    if (!Number.isFinite(detour) || detour > tau * 7) continue;
    const w = Math.exp(-Math.max(0, detour) / tau);
    dist[i] = w;
    sum += w;
  }
  if (sum > 0) for (let i = 0; i < N; i++) dist[i] /= sum;

  // Fastest route: walk downhill in travel time from the found cell back to the LKP.
  const raw: GridPoint[] = [{ x: found.x + 0.5, y: found.y + 0.5 }];
  let cur = fi;
  const start = lkp.y * W + lkp.x;
  for (let guard = 0; cur !== start && guard < N; guard++) {
    const x = cur % W;
    const y = (cur / W) | 0;
    let best = cur;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= grid.height) continue;
        const j = ny * W + nx;
        if (travelFromLkp[j] < travelFromLkp[best]) best = j;
      }
    if (best === cur) break;
    cur = best;
    raw.push({ x: (cur % W) + 0.5, y: ((cur / W) | 0) + 0.5 });
  }
  raw.reverse();
  let km = 0;
  for (let k = 1; k < raw.length; k++) km += Math.hypot(raw[k].x - raw[k - 1].x, raw[k].y - raw[k - 1].y) * grid.cellSizeM;
  return { distribution: dist, route: raw, routeKm: km / 1000, routeHours: travelFromLkp[fi] };
}
