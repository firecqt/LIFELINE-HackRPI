import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Layers, Leaf, Map as MapIcon, Mountain } from 'lucide-react';
import type { MapOverlays, TerrainViewMode } from '../../types/terrain';
import { Segmented } from '../ui';

export const DEFAULT_OVERLAYS: MapOverlays = {
  lkp: true,
  estimatedLocation: true,
  drones: true,
  flightPaths: false,
  droneBoundaries: true,
  heatmap: true,
  searchArea: true,
  travelRange: false,
  ownership: false,
  trails: true,
  grid: false,
};

export const OVERLAY_LABELS: { key: keyof MapOverlays; label: string; hint: string }[] = [
  { key: 'heatmap', label: 'Search probability', hint: 'Purple = where the person most likely is' },
  { key: 'lkp', label: 'Last seen', hint: 'Where the person was last seen' },
  { key: 'estimatedLocation', label: 'Best guess', hint: 'Center of the probability and its spread' },
  { key: 'drones', label: 'Drones', hint: 'Live position, heading and camera footprint' },
  { key: 'droneBoundaries', label: 'Drone assignments', hint: 'Squares each drone is searching next' },
  { key: 'searchArea', label: 'Search area', hint: 'How far they could have walked' },
  { key: 'travelRange', label: 'Walking range', hint: 'Rings at ⅓, ⅔ and full walking time' },
  { key: 'ownership', label: 'Searched ground', hint: 'Shaded where a drone has already looked' },
  { key: 'flightPaths', label: 'Flight paths', hint: 'Where each drone has flown' },
  { key: 'trails', label: 'Trails & landmarks', hint: 'Trails, peaks, lakes, ranger stations' },
  { key: 'grid', label: 'Grid', hint: 'Search grid when zoomed in' },
];

export const MODE_OPTIONS: { value: TerrainViewMode; label: string; icon: JSX.Element }[] = [
  { value: 'terrain', label: 'Terrain', icon: <MapIcon size={13} /> },
  { value: 'elevation', label: 'Elevation', icon: <Mountain size={13} /> },
  { value: 'vegetation', label: 'Vegetation', icon: <Leaf size={13} /> },
];

export function LayerMenu({
  overlays,
  onChange,
  available,
  opacity,
  onOpacity,
}: {
  overlays: MapOverlays;
  onChange: (o: MapOverlays) => void;
  available?: (keyof MapOverlays)[];
  opacity?: number;
  onOpacity?: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const items = OVERLAY_LABELS.filter((o) => !available || available.includes(o.key));
  const on = items.filter((o) => overlays[o.key]).length;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx('inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', open ? 'border-accent/50 bg-elevated text-accent' : 'border-line bg-panel text-muted hover:text-ink')}
      >
        <Layers size={14} /> Layers
        <span className="rounded bg-elevated px-1.5 font-mono text-[10px] text-ink">
          {on}/{items.length}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 w-[300px] animate-slideIn rounded-lg border border-line bg-panel p-2 shadow-float">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-[12px] font-semibold text-ink">Show on map</span>
            <div className="flex gap-2 text-[11px]">
              <button className="text-muted hover:text-accent" onClick={() => onChange(Object.fromEntries(Object.keys(overlays).map((k) => [k, true])) as unknown as MapOverlays)}>
                All
              </button>
              <button className="text-muted hover:text-accent" onClick={() => onChange(Object.fromEntries(Object.keys(overlays).map((k) => [k, false])) as unknown as MapOverlays)}>
                None
              </button>
            </div>
          </div>
          {items.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-elevated">
              <input type="checkbox" className="mt-0.5 accent-[#2556E8]" checked={overlays[o.key]} onChange={(e) => onChange({ ...overlays, [o.key]: e.target.checked })} />
              <span>
                <span className="block text-[12.5px] text-ink">{o.label}</span>
                <span className="block text-[10.5px] text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
          {onOpacity && opacity !== undefined && (
            <div className="mt-1 border-t border-line px-2 pb-1 pt-2">
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>Probability shading</span>
                <span className="font-mono text-ink">{Math.round(opacity * 100)}%</span>
              </div>
              <input type="range" min={0.15} max={1} step={0.05} value={opacity} onChange={(e) => onOpacity(Number(e.target.value))} className="w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ViewModeSwitch({ mode, onChange, options = MODE_OPTIONS }: { mode: TerrainViewMode; onChange: (m: TerrainViewMode) => void; options?: typeof MODE_OPTIONS }) {
  return <Segmented size="sm" value={mode} onChange={onChange} options={options} />;
}
