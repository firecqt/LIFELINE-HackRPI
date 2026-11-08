import type { TerrainGrid } from '../../types/terrain';
import type { MissionEnvironment, SimState } from '../../types/simulation';
import { VEGETATION_LABELS } from '../../types/terrain';
import { cellToLatLon, getCellView } from '../../services/terrainService';
import { formatDuration, formatLatLon, formatProb } from '../../lib/format';
import { cellPod } from '../../services/probabilityService';
import { BLOCK, blockLabel } from '../../services/missionService';

const STATUS_COLOR = { unsearched: '#5F6B7D', assigned: '#2556E8', searched: '#0E9F6E' } as const;

export function cellRows(grid: TerrainGrid, x: number, y: number, env?: MissionEnvironment | null, sim?: SimState | null, distribution?: Float32Array | null) {
  const cell = getCellView(grid, x, y, env, sim, distribution);
  const ll = cellToLatLon(grid, x + 0.5, y + 0.5);
  const i = y * grid.width + x;
  const drone = cell.assignedDroneId ? sim?.drones.find((d) => d.id === cell.assignedDroneId) : null;
  const blockIdx = env ? Math.floor(y / BLOCK) * env.blocksW + Math.floor(x / BLOCK) : -1;
  return {
    cell,
    ll,
    water: grid.water[i],
    slope: grid.slope[i],
    pod: cellPod(0.9, grid.vegetationDensity[i]),
    travel: env ? env.travelTime[i] : null,
    inArea: env ? !!env.searchArea[i] : null,
    drone,
    block: blockIdx >= 0 ? blockLabel(blockIdx) : null,
    sector: env && blockIdx >= 0 ? env.blocks[blockIdx]?.sector : null,
    likelihood: sim ? sim.likelihood[i] : null,
  };
}

export default function TerrainTooltip({ grid, x, y, env, sim, distribution }: { grid: TerrainGrid; x: number; y: number; env?: MissionEnvironment | null; sim?: SimState | null; distribution?: Float32Array | null }) {
  const r = cellRows(grid, x, y, env, sim, distribution);
  const { cell } = r;
  return (
    <div className="w-[236px] rounded-lg border border-line bg-panel/95 p-3 text-[11px] shadow-float backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[12px] font-semibold text-ink">
          ({x}, {y})
        </span>
        {r.block && (
          <span className="font-mono text-[10px] text-muted">
            {r.block} · {r.sector}
          </span>
        )}
      </div>
      <div className="mb-2 font-mono text-[10.5px] text-info">{formatLatLon(r.ll.latitude, r.ll.longitude, 5)}</div>
      <Row k="Elevation" v={`${Math.round(cell.elevation).toLocaleString()} m`} />
      <Row k="Slope" v={`${r.slope.toFixed(1)}°`} />
      <Row k="Vegetation" v={r.water ? (r.water === 1 ? 'Open water' : 'River') : `${cell.vegetation} · ${VEGETATION_LABELS[cell.vegetation]}`} />
      <Row k="Veg. density" v={`${Math.round(cell.vegetationDensity * 100)}%`} />
      {(sim || distribution) && (
        <>
          <div className="my-1.5 h-px bg-line" />
          <Row k="Probability" v={formatProb(cell.probability)} color="#C88A04" />
          <Row k="Thermal POD" v={`${Math.round(r.pod * 100)}%`} />
          {r.travel !== null && <Row k="Travel from LKP" v={r.travel < Infinity ? formatDuration(r.travel) : 'unreachable'} />}
          <Row k="Search status" v={r.inArea === false ? 'outside area' : cell.searchStatus} color={r.inArea === false ? '#5F6B7D' : STATUS_COLOR[cell.searchStatus]} />
          <Row k="Assigned drone" v={r.drone ? r.drone.id : '—'} color={r.drone?.color} />
        </>
      )}
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex justify-between gap-2 py-[1.5px]">
      <span className="text-muted">{k}</span>
      <span className="truncate font-mono text-ink" style={color ? { color } : undefined}>
        {v}
      </span>
    </div>
  );
}
