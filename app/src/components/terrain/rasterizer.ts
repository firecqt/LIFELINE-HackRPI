/**
 * Terrain rasterizer — converts a TerrainGrid into cached, hillshaded base images for each
 * view mode. Built once per (grid, mode) so drone/heatmap animation never re-renders terrain.
 */
import type { TerrainGrid, TerrainViewMode } from '../../types/terrain';
import { ELEV_LUT, SLOPE_LUT, VEGETATION_COLORS, hexToRgb } from '../../lib/colors';
import { hash2, valueNoise } from '../../lib/noise';

export const RASTER_SCALE = 8;

interface Prepared {
  E: Float32Array;
  shade: Float32Array;
  pw: number;
  ph: number;
}

const prepared = new Map<string, Prepared>();
const rasters = new Map<string, HTMLCanvasElement>();

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function prepare(g: TerrainGrid): Prepared {
  const hit = prepared.get(g.id);
  if (hit) return hit;
  const S = RASTER_SCALE;
  const W = g.width;
  const H = g.height;
  const pw = W * S;
  const ph = H * S;
  const el = g.elevation;
  const tmp = new Float32Array(pw * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let px = 0; px < pw; px++) {
      const u = (px + 0.5) / S - 0.5;
      const x1 = Math.floor(u);
      const t = u - x1;
      const c = (x: number) => el[row + (x < 0 ? 0 : x >= W ? W - 1 : x)];
      tmp[y * pw + px] = catmull(c(x1 - 1), c(x1), c(x1 + 1), c(x1 + 2), t);
    }
  }
  const E = new Float32Array(pw * ph);
  for (let py = 0; py < ph; py++) {
    const v = (py + 0.5) / S - 0.5;
    const y1 = Math.floor(v);
    const t = v - y1;
    const r = (y: number) => (y < 0 ? 0 : y >= H ? H - 1 : y) * pw;
    const r0 = r(y1 - 1);
    const r1 = r(y1);
    const r2 = r(y1 + 1);
    const r3 = r(y1 + 2);
    const o = py * pw;
    for (let px = 0; px < pw; px++) {
      E[o + px] = catmull(tmp[r0 + px], tmp[r1 + px], tmp[r2 + px], tmp[r3 + px], t) + (valueNoise(px * 0.16, py * 0.16, 913) - 0.5) * 3.5;
    }
  }
  const shade = new Float32Array(pw * ph);
  const pm = g.cellSizeM / S;
  const Z = 1.5;
  let lx = -0.6;
  let ly = -0.6;
  let lz = 0.53;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll;
  ly /= ll;
  lz /= ll;
  for (let py = 0; py < ph; py++) {
    const up = Math.max(0, py - 1) * pw;
    const dn = Math.min(ph - 1, py + 1) * pw;
    const o = py * pw;
    for (let px = 0; px < pw; px++) {
      const l = E[o + Math.max(0, px - 1)];
      const r = E[o + Math.min(pw - 1, px + 1)];
      const dzdx = ((r - l) / (2 * pm)) * Z;
      const dzdy = ((E[dn + px] - E[up + px]) / (2 * pm)) * Z;
      const len = Math.hypot(dzdx, dzdy, 1);
      const dot = (-dzdx * lx - dzdy * ly + lz) / len;
      shade[o + px] = Math.max(0.25, dot / lz);
    }
  }
  const p = { E, shade, pw, ph };
  prepared.set(g.id, p);
  return p;
}

const C = (hex: string) => hexToRgb(hex);
const ROCK = C('#8b857a');
const ROCK2 = C('#a39d90');
const SNOW = C('#eef1f3');
const GRASS = C('#9aa35f');
const GRASS2 = C('#b6b47a');
const SHRUB = C('#738a49');
const SHRUB_D = C('#4f6634');
const TREE = C('#3f6a36');
const TREE_D = C('#2b4e28');
const DENSE = C('#264a2b');
const DENSE_D = C('#18341d');
const DEEP = C('#0f3a50');
const SHALLOW = C('#3c7f88');
const VEG = VEGETATION_COLORS.map(C);
// "Terrain" basemap palette: soft, map-like land-cover tints under a gentle hillshade.
const T_ROCK = C('#ebe7df');
const T_GRASS = C('#e9f0d8');
const T_SHRUB = C('#dcebc9');
const T_TREE = C('#c8e1b6');
const T_DENSE = C('#b5d6a0');
const T_SNOW = C('#fbfbf9');
const T_WATER = C('#aad3f0');
const T_CONTOUR = C('#a58f6c');
const VEG_WATER = C('#2a5d8a');

export function getRaster(g: TerrainGrid, mode: TerrainViewMode): HTMLCanvasElement {
  const key = `${g.id}|${mode}`;
  const hit = rasters.get(key);
  if (hit) return hit;
  const { E, shade, pw, ph } = prepare(g);
  const S = RASTER_SCALE;
  const W = g.width;
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(pw, ph);
  const d = img.data;
  const range = g.maxElevation - g.minElevation;
  const seed = 4211;
  for (let py = 0; py < ph; py++) {
    const cy = Math.min(g.height - 1, (py / S) | 0);
    for (let px = 0; px < pw; px++) {
      const k = py * pw + px;
      const cx = Math.min(W - 1, (px / S) | 0);
      const ci = cy * W + cx;
      const e = E[k];
      const sh = shade[k];
      const lake = e < g.lakeLevel;
      let r = 0;
      let gg = 0;
      let b = 0;
      if (mode === 'terrain') {
        // Only treat sub-lake-level pixels as lake near real lake cells; carved river channels on
        // flat ground otherwise dip below lake level and render as swirls of water.
        let nearLake = g.water[ci] === 1;
        if (lake && !nearLake) {
          for (let dy = -1; dy <= 1 && !nearLake; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && ny >= 0 && nx < W && ny < g.height && g.water[ny * W + nx] === 1) {
                nearLake = true;
                break;
              }
            }
        }
        if (nearLake && (lake || g.water[ci] === 1)) [r, gg, b] = T_WATER;
        else {
          const cls = g.vegetation[ci];
          let c = cls === 0 ? T_ROCK : cls === 1 ? T_GRASS : cls === 2 ? T_SHRUB : cls === 3 ? T_TREE : T_DENSE;
          if (e > g.snowline) c = T_SNOW;
          // Soft relief: lit slopes brighten slightly, shaded slopes darken.
          const f = Math.max(0.7, Math.min(1.06, 0.74 + 0.27 * sh));
          r = c[0] * f;
          gg = c[1] * f;
          b = c[2] * f;
          const band = Math.floor(e / 50);
          const right = px < pw - 1 ? Math.floor(E[k + 1] / 50) : band;
          const below = py < ph - 1 ? Math.floor(E[k + pw] / 50) : band;
          if (band !== right || band !== below) {
            const major = Math.floor(e / 250) !== Math.floor((band !== right ? E[k + 1] : E[k + pw]) / 250);
            const a = major ? 0.5 : 0.22;
            r += (T_CONTOUR[0] - r) * a;
            gg += (T_CONTOUR[1] - gg) * a;
            b += (T_CONTOUR[2] - b) * a;
          }
        }
      } else if (mode === 'elevation') {
        if (lake) {
          [r, gg, b] = [44, 92, 130];
        } else {
          const t = Math.max(0, Math.min(1, (e - g.minElevation) / range));
          const li = Math.round(t * 255) * 3;
          const f = Math.min(1.3, 0.6 + 0.4 * sh);
          r = ELEV_LUT[li] * f;
          gg = ELEV_LUT[li + 1] * f;
          b = ELEV_LUT[li + 2] * f;
          // Contours every 50 m (index every 250 m)
          const band = Math.floor(e / 50);
          const right = px < pw - 1 ? Math.floor(E[k + 1] / 50) : band;
          const below = py < ph - 1 ? Math.floor(E[k + pw] / 50) : band;
          if (band !== right || band !== below) {
            const major = Math.floor(e / 250) !== Math.floor((band !== right ? E[k + 1] : E[k + pw]) / 250);
            const m = major ? 0.55 : 0.8;
            r *= m;
            gg *= m;
            b *= m;
          }
        }
      } else if (mode === 'vegetation') {
        if (g.water[ci] === 1 || lake) [r, gg, b] = VEG_WATER;
        else {
          const c = VEG[g.vegetation[ci]];
          const dens = g.vegetationDensity[ci];
          const f = (0.78 + 0.3 * dens) * (0.82 + 0.18 * sh);
          r = c[0] * f;
          gg = c[1] * f;
          b = c[2] * f;
          const ex = px % S;
          const ey = py % S;
          if (ex === 0 || ey === 0) {
            r *= 0.88;
            gg *= 0.88;
            b *= 0.88;
          }
        }
      } else if (mode === 'slope') {
        if (lake) [r, gg, b] = [36, 70, 104];
        else {
          const t = Math.min(1, g.slope[ci] / 50);
          const li = Math.round(t * 255) * 3;
          const f = 0.75 + 0.25 * sh;
          r = SLOPE_LUT[li] * f;
          gg = SLOPE_LUT[li + 1] * f;
          b = SLOPE_LUT[li + 2] * f;
        }
      } else {
        // Legacy imagery-style base, kept only for the dark 'probability' mode (not offered in the UI)
        const n1 = valueNoise(px * 0.07, py * 0.07, seed);
        const n2 = hash2(px, py, seed);
        if (lake) {
          const depth = Math.min(1, (g.lakeLevel - e) / 25);
          r = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * depth;
          gg = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * depth;
          b = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * depth;
          const ripple = (valueNoise(px * 0.25, py * 0.6, seed + 5) - 0.5) * 10;
          r += ripple;
          gg += ripple;
          b += ripple;
        } else {
          const jx = Math.min(W - 1, Math.max(0, Math.floor(px / S + (n1 - 0.5) * 1.5)));
          const jy = Math.min(g.height - 1, Math.max(0, Math.floor(py / S + (valueNoise(px * 0.07 + 31, py * 0.07, seed) - 0.5) * 1.5)));
          const j = jy * W + jx;
          const cls = g.vegetation[j];
          let c: number[];
          if (e > g.snowline + (n1 - 0.5) * 120) c = SNOW;
          else if (cls === 0) {
            const m = valueNoise(px * 0.2, py * 0.2, seed + 9);
            c = [ROCK[0] + (ROCK2[0] - ROCK[0]) * m, ROCK[1] + (ROCK2[1] - ROCK[1]) * m, ROCK[2] + (ROCK2[2] - ROCK[2]) * m];
          } else if (cls === 1) {
            c = [GRASS[0] + (GRASS2[0] - GRASS[0]) * n1, GRASS[1] + (GRASS2[1] - GRASS[1]) * n1, GRASS[2] + (GRASS2[2] - GRASS[2]) * n1];
          } else if (cls === 2) c = n2 > 0.8 ? SHRUB_D : SHRUB;
          else {
            const crown = valueNoise(px * 0.42, py * 0.42, seed + 17);
            c = cls === 3 ? (crown > 0.55 ? TREE_D : TREE) : crown > 0.5 ? DENSE_D : DENSE;
            if (cls === 3 && crown < 0.22) c = SHRUB;
          }
          const f = Math.min(1.35, 0.42 + 0.62 * sh) * (0.94 + n2 * 0.1);
          r = c[0] * f;
          gg = c[1] * f;
          b = c[2] * f;
        }
        if (mode === 'probability') {
          const gray = 0.3 * r + 0.59 * gg + 0.11 * b;
          r = (gray * 0.6 + r * 0.4) * 0.5 + 9;
          gg = (gray * 0.6 + gg * 0.4) * 0.5 + 15;
          b = (gray * 0.6 + b * 0.4) * 0.5 + 24;
        }
      }
      const o = k * 4;
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Rivers as smooth strokes
  const riverColor = mode === 'terrain' ? '#9ccbec' : mode === 'probability' ? '#2b4f63' : mode === 'elevation' ? '#3d78a6' : mode === 'vegetation' || mode === 'slope' ? '#2a5d8a' : '#3b7a8c';
  ctx.save();
  ctx.scale(S, S);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const river of g.rivers) {
    for (let pass = mode === 'terrain' ? 1 : 0; pass < 2; pass++) {
      ctx.beginPath();
      river.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = pass === 0 ? (mode === 'terrain' ? 'rgba(255,255,255,0.7)' : 'rgba(10,30,40,0.35)') : riverColor;
      ctx.lineWidth = pass === 0 ? 1.0 : mode === 'terrain' ? 0.38 : 0.62;
      ctx.stroke();
    }
  }
  ctx.restore();
  rasters.set(key, canvas);
  return canvas;
}

/** Pre-builds a base-map raster (e.g. for map previews) so the first draw is instant. */
export function warmRaster(g: TerrainGrid, mode: TerrainViewMode) {
  getRaster(g, mode);
}
