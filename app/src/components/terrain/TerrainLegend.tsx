import type { TerrainGrid, TerrainViewMode } from '../../types/terrain';
import { ELEVATION_STOPS, PROBABILITY_STOPS, SLOPE_STOPS, VEGETATION_COLORS, rampCss } from '../../lib/colors';
import { VEGETATION_LABELS } from '../../types/terrain';
import { formatProb } from '../../lib/format';

export default function TerrainLegend({ mode, grid, maxProbability, showOwnership, showProbability }: { mode: TerrainViewMode; grid: TerrainGrid; maxProbability?: number; showOwnership?: boolean; showProbability?: boolean }) {
  return (
    <div className="w-[230px] rounded-lg border border-line bg-panel/95 p-3 text-[11px] shadow-float backdrop-blur">
      {mode === 'terrain' && (
        <>
          <div className="mb-1.5 font-semibold text-ink">Terrain</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[
              ['#b5d6a0', 'Dense forest'],
              ['#c8e1b6', 'Forest'],
              ['#e9f0d8', 'Meadow / shrub'],
              ['#ebe7df', 'Rock'],
              ['#aad3f0', 'Water'],
              ['#9a5b2e', 'Trail'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1.5 text-muted">
                <span className="h-2.5 w-2.5 rounded-sm border border-black/10" style={{ background: c }} /> {l}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-muted">Contours every 50 m · bold every 250 m</div>
        </>
      )}
      {mode === 'elevation' && (
        <>
          <div className="mb-1.5 font-semibold text-ink">Elevation</div>
          <div className="h-2.5 rounded-full" style={{ background: rampCss(ELEVATION_STOPS) }} />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
            <span>{Math.round(grid.minElevation).toLocaleString()} m</span>
            <span>{Math.round(grid.maxElevation).toLocaleString()} m</span>
          </div>
          <div className="mt-2 text-[10px] text-muted">Contours every 50 m · index every 250 m · NW hillshade</div>
        </>
      )}
      {mode === 'vegetation' && (
        <>
          <div className="mb-1.5 font-semibold text-ink">Vegetation density → detection</div>
          {VEGETATION_LABELS.map((l, i) => {
            const dens = [0.02, 0.18, 0.42, 0.7, 0.92][i];
            return (
              <div key={l} className="flex items-center gap-2 py-0.5 text-muted">
                <span className="font-mono text-[10px] text-ink">{i}</span>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: VEGETATION_COLORS[i] }} />
                <span className="flex-1">{l}</span>
                <span className="font-mono text-[10px]" style={{ color: dens > 0.6 ? '#E5364B' : dens > 0.3 ? '#C88A04' : '#0E9F6E' }}>
                  POD −{Math.round(72 * dens)}%
                </span>
              </div>
            );
          })}
          <div className="mt-1.5 text-[10px] text-muted">Canopy occludes thermal sensing: POD = sensor POD × (1 − 0.72·density)</div>
        </>
      )}
      {mode === 'slope' && (
        <>
          <div className="mb-1.5 font-semibold text-ink">Slope</div>
          <div className="h-2.5 rounded-full" style={{ background: rampCss(SLOPE_STOPS) }} />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
            <span>0°</span>
            <span>25°</span>
            <span>50°+</span>
          </div>
          <div className="mt-2 text-[10px] text-muted">Steeper terrain slows hikers (Tobler) and raises drone climb cost.</div>
        </>
      )}
      {(mode === 'probability' || showProbability) && (
        <div className={mode === 'probability' ? '' : 'mt-2.5 border-t border-line pt-2'}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-semibold text-ink">Search probability</span>
            <span className="text-[9.5px] text-info">simulated</span>
          </div>
          <div className="h-2.5 rounded-full" style={{ background: rampCss(PROBABILITY_STOPS) }} />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
            <span>low</span>
            <span>{maxProbability ? `peak ${formatProb(maxProbability)}` : 'high'}</span>
          </div>
          <div className="mt-1.5 text-[10px] leading-snug text-muted">Likelihood the person is in each cell, from the search model.</div>
        </div>
      )}
      {showOwnership && (
        <div className="mt-2.5 flex items-center gap-3 border-t border-line pt-2 text-[10px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-accent bg-accent/50" /> Assigned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg,#0E9F6E 0 1px,#0E9F6E22 1px 4px)' }} /> Searched
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-3 border-t-2 border-dashed border-accent" /> Boundary
          </span>
        </div>
      )}
    </div>
  );
}
