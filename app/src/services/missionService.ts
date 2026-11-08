/**
 * missionService — builds a `MissionEnvironment` (terrain + search geometry) for a mission.
 * A backend would return the same structure from real DEM / land-cover / model outputs.
 */
import type { Mission, MissingPersonReport, Park } from '../types/mission';
import type { MissionEnvironment, SearchBlock } from '../types/simulation';
import { getTerrain } from './terrainService';
import { cellPod, computeBehavior, computeTravelTime, hikerMobileHours } from './probabilityService';

export const BLOCK = 4;
const MIN_AREA_CELLS = 1400;
const MAX_AREA_CELLS = 3400;
const SECTOR_COLS = 3;
const SECTOR_ROWS = 2;
const SECTOR_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

export function blockLabel(index: number): string {
  return `C-${String(index).padStart(4, '0')}`;
}

export function createEnvironment(mission: Mission, report: MissingPersonReport, park: Park, hoursOverride?: number): MissionEnvironment {
  const grid = getTerrain(park, report.id, report.lkp);
  const W = grid.width;
  const H = grid.height;
  const lkp = { ...grid.anchor };
  const base = grid.landmarks.find((l) => l.type === 'ranger') ?? { x: lkp.x, y: lkp.y };
  const travelTime = computeTravelTime(grid, lkp, report.hikingSpeedKmh);
  const behavior = computeBehavior(grid, lkp);
  const hours = hoursOverride ?? report.hoursMissing;
  // Nominal reach (Tobler) over the next operational period, then clamp the search area to a
  // workable size; the prior's mobility scale follows so the PDF fills the same region.
  const nominal = hikerMobileHours(hours + 1.5) * 1.12;
  const reachable = Array.from(travelTime).filter((t, i) => t < Infinity && grid.water[i] !== 1).sort((a, b) => a - b);
  const nominalCount = reachable.filter((t) => t <= nominal).length;
  const targetCount = Math.min(reachable.length, Math.max(MIN_AREA_CELLS, Math.min(MAX_AREA_CELLS, nominalCount)));
  const limit = reachable[Math.max(0, targetCount - 1)] ?? nominal;
  const mobileScale = limit / nominal;
  const searchArea = new Uint8Array(W * H);
  let searchAreaCells = 0;
  const pod = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    pod[i] = cellPod(0.9, grid.vegetationDensity[i]);
    if (travelTime[i] <= limit && grid.water[i] !== 1) {
      searchArea[i] = 1;
      searchAreaCells++;
    } else behavior[i] = 0;
  }
  const blocksW = Math.ceil(W / BLOCK);
  const blocksH = Math.ceil(H / BLOCK);
  const blocks: SearchBlock[] = [];
  for (let by = 0; by < blocksH; by++)
    for (let bx = 0; bx < blocksW; bx++) {
      const index = by * blocksW + bx;
      const cells: number[] = [];
      let elev = 0;
      for (let y = by * BLOCK; y < Math.min(H, by * BLOCK + BLOCK); y++)
        for (let x = bx * BLOCK; x < Math.min(W, bx * BLOCK + BLOCK); x++) {
          const i = y * W + x;
          elev += grid.elevation[i];
          if (searchArea[i]) cells.push(i);
        }
      const sc = Math.min(SECTOR_COLS - 1, Math.floor((bx / blocksW) * SECTOR_COLS));
      const sr = Math.min(SECTOR_ROWS - 1, Math.floor((by / blocksH) * SECTOR_ROWS));
      blocks.push({
        index,
        id: blockLabel(index),
        bx,
        by,
        cells,
        sector: SECTOR_NAMES[sr * SECTOR_COLS + sc],
        center: { x: bx * BLOCK + BLOCK / 2, y: by * BLOCK + BLOCK / 2 },
        meanElevation: elev / (BLOCK * BLOCK),
      });
    }
  const sectors = SECTOR_NAMES.filter((s) => blocks.some((b) => b.sector === s && b.cells.length > 0));
  return {
    missionId: mission.id,
    report,
    park,
    grid,
    lkp,
    base: { x: Math.floor(base.x), y: Math.floor(base.y) },
    travelTime,
    behavior,
    searchArea,
    searchAreaCells,
    pod,
    blocks,
    blocksW,
    blocksH,
    sectors,
    hoursMissingAtStart: hours,
    mobileScale,
  };
}

export function sectorOf(env: MissionEnvironment, x: number, y: number): string {
  const b = env.blocks[Math.floor(y / BLOCK) * env.blocksW + Math.floor(x / BLOCK)];
  return b?.sector ?? '—';
}
