/**
 * TerrainMap — canvas renderer for the search environment.
 *
 * It *consumes* data only: a TerrainGrid, an optional MissionEnvironment/SimState and a
 * probability distribution. Layers:
 *   cached base raster → travel range → probability heatmap (+isolines) → cell ownership →
 *   grid → search boundary/isochrones → trails & landmarks → drone boundaries → auction →
 *   flight paths → sensor footprints & drones → LKP → estimated location → signals → cursor.
 * Terrain is never re-rasterized per frame; drones interpolate between ticks.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import type { GridPoint, MapOverlays, TerrainGrid, TerrainViewMode } from '../../types/terrain';
import type { MissionEnvironment, SimState } from '../../types/simulation';
import { getRaster } from './rasterizer';
import { drawDrone, drawFoundMarker, drawPin, drawLandmark, drawLkp, drawSignal, roundRect } from './drawing';
import { contourPath } from '../../lib/contours';
import { PROB_LUT, hexToRgb, rgba } from '../../lib/colors';
import { tickTiming } from '../../hooks/tickTiming';
import { BLOCK } from '../../services/missionService';
import { cellToLatLon } from '../../services/terrainService';
import { formatLatLon } from '../../lib/format';

export interface MapFocus {
  x: number;
  y: number;
  zoom?: number;
  nonce: number;
}

export interface TerrainMapProps {
  grid: TerrainGrid;
  mode: TerrainViewMode;
  overlays: MapOverlays;
  env?: MissionEnvironment | null;
  sim?: SimState | null;
  distribution?: Float32Array | null;
  heatmapOpacity?: number;
  selectedCell?: GridPoint | null;
  onSelectCell?: (c: GridPoint | null) => void;
  selectedDroneId?: string | null;
  onSelectDrone?: (id: string | null) => void;
  onSelectSignal?: (id: string) => void;
  focus?: MapFocus | null;
  renderTooltip?: (x: number, y: number) => ReactNode;
  showMinimap?: boolean;
  searchBoundary?: Uint8Array | null;
  /** World-space region to frame on load and when "fit" is pressed. */
  fitBounds?: { x0: number; y0: number; x1: number; y1: number } | null;
  lkp?: GridPoint | null;
  /** Extra polylines in grid units (e.g. a reconstructed hiker route). */
  routes?: { points: GridPoint[]; color: string; width?: number; dashed?: boolean }[];
  /** "Found" pins drawn above everything else. */
  foundMarkers?: { x: number; y: number; title: string; sub: string }[];
  /** Reference positions drawn as a ring + label (cell coordinates, centre = +0.5). */
  pins?: { x: number; y: number; label: string; color: string }[];
  showGrid?: boolean;
  reducedMotion?: boolean;
  children?: ReactNode;
}

const OWN_SCALE = 4;

interface View {
  scale: number;
  ox: number;
  oy: number;
}

export default function TerrainMap(props: TerrainMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewRef = useRef<View>({ scale: 4, ox: 0, oy: 0 });
  const fitRef = useRef(4);
  const sizeRef = useRef({ w: 800, h: 600, dpr: 1 });
  const animRef = useRef<{ from: View; to: View; start: number; dur: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; id: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const [, setZoomTick] = useState(0);

  // Offscreen layers & caches
  const layers = useRef({
    heat: null as HTMLCanvasElement | null,
    heatData: null as ImageData | null,
    display: null as Float32Array | null,
    displayMax: 0,
    isoPath: [] as Path2D[],
    isoFrame: 0,
    own: null as HTMLCanvasElement | null,
    ownVersion: -1,
    ownSim: null as SimState | null,
    range: null as HTMLCanvasElement | null,
    rangeKey: '',
    rangePaths: [] as Path2D[],
    boundary: null as Path2D | null,
    boundaryKey: null as unknown,
    negT: null as Float32Array | null,
    negTKey: null as unknown,
    auctionId: -1,
    auctionStart: 0,
    frame: 0,
    lastOpacity: -1,
  });

  // ---- sizing --------------------------------------------------------------------------
  const fittedRef = useRef(true);
  const fitView = (animate: boolean) => {
    const { w, h } = sizeRef.current;
    const g = propsRef.current.grid;
    const base = Math.min(w / g.width, h / g.height) * 0.98;
    fitRef.current = base;
    const b = propsRef.current.fitBounds;
    let to: View;
    if (b) {
      const bw = b.x1 - b.x0;
      const bh = b.y1 - b.y0;
      const scale = Math.max(base, Math.min(48, Math.min(w / bw, h / bh) * 0.94));
      to = { scale, ox: w / 2 - ((b.x0 + b.x1) / 2) * scale, oy: h / 2 - ((b.y0 + b.y1) / 2) * scale };
    } else to = { scale: base, ox: (w - g.width * base) / 2, oy: (h - g.height * base) / 2 };
    fittedRef.current = true;
    if (animate) animRef.current = { from: { ...viewRef.current }, to, start: performance.now(), dur: 450 };
    else viewRef.current = to;
  };

  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: Math.max(50, r.width), h: Math.max(50, r.height), dpr };
      const c = canvasRef.current!;
      c.width = Math.round(sizeRef.current.w * dpr);
      c.height = Math.round(sizeRef.current.h * dpr);
      c.style.width = `${sizeRef.current.w}px`;
      c.style.height = `${sizeRef.current.h}px`;
      if (fittedRef.current) fitView(false);
      else {
        const g = propsRef.current.grid;
        fitRef.current = Math.min(sizeRef.current.w / g.width, sizeRef.current.h / g.height) * 0.98;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fitView(false);
    layers.current.display = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.grid.id]);

  // ---- focus requests --------------------------------------------------------------------
  useEffect(() => {
    const f = props.focus;
    if (!f) return;
    const { w, h } = sizeRef.current;
    const scale = Math.min(48, fitRef.current * (f.zoom ?? 3));
    fittedRef.current = false;
    animRef.current = { from: { ...viewRef.current }, to: { scale, ox: w / 2 - f.x * scale, oy: h / 2 - f.y * scale }, start: performance.now(), dur: 650 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.nonce]);

  // ---- render loop --------------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      try {
        render(now);
      } catch (e) {
        console.error(e);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clampView(v: View): View {
    const { w, h } = sizeRef.current;
    const g = propsRef.current.grid;
    const gw = g.width * v.scale;
    const gh = g.height * v.scale;
    const mx = w * 0.5;
    const my = h * 0.5;
    return {
      scale: v.scale,
      ox: Math.min(mx, Math.max(w - gw - mx, v.ox)),
      oy: Math.min(my, Math.max(h - gh - my, v.oy)),
    };
  }

  function render(now: number) {
    const p = propsRef.current;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const L = layers.current;
    L.frame++;
    const g = p.grid;
    const W = g.width;
    const H = g.height;
    const { w, h, dpr } = sizeRef.current;

    if (animRef.current) {
      const a = animRef.current;
      const t = Math.min(1, (now - a.start) / a.dur);
      const e = 1 - Math.pow(1 - t, 3);
      viewRef.current = {
        scale: a.from.scale + (a.to.scale - a.from.scale) * e,
        ox: a.from.ox + (a.to.ox - a.from.ox) * e,
        oy: a.from.oy + (a.to.oy - a.from.oy) * e,
      };
      if (t >= 1) animRef.current = null;
    }
    const v = viewRef.current;
    const S = v.scale;
    const toSx = (x: number) => v.ox + x * S;
    const toSy = (y: number) => v.oy + y * S;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9eef0';
    ctx.fillRect(0, 0, w, h);

    // World transform
    const world = () => ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * v.ox, dpr * v.oy);
    const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    world();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(getRaster(g, p.mode), 0, 0, W, H);
    const px = 1 / S; // one screen pixel in world units
    const light = p.mode !== 'probability'; // light basemaps need dark linework; the dark legacy base needs light

    const env = p.env ?? null;
    const sim = p.sim ?? null;

    // Travel range (estimated hiker movement) — terrain-aware isochrones
    if (env && sim && p.overlays.travelRange) {
      if (L.negTKey !== env) {
        L.negT = new Float32Array(env.travelTime.length);
        for (let i = 0; i < L.negT.length; i++) L.negT[i] = -Math.min(env.travelTime[i], 50);
        L.negTKey = env;
      }
      const key = `${env.missionId}|${sim.mobileHours.toFixed(3)}`;
      if (L.rangeKey !== key) {
        L.rangeKey = key;
        if (!L.range) {
          L.range = document.createElement('canvas');
          L.range.width = W;
          L.range.height = H;
        }
        const rc = L.range.getContext('2d')!;
        const img = rc.createImageData(W, H);
        const tm = sim.mobileHours;
        for (let i = 0; i < W * H; i++) {
          const T = env.travelTime[i];
          if (T <= tm) {
            const f = T / tm;
            img.data[i * 4] = 37;
            img.data[i * 4 + 1] = 86;
            img.data[i * 4 + 2] = 232;
            img.data[i * 4 + 3] = 30 + f * 40;
          }
        }
        rc.putImageData(img, 0, 0);
        L.rangePaths = [0.33, 0.66, 1].map((f) => contourPath(L.negT!, W, H, -tm * f));
      }
      ctx.drawImage(L.range!, 0, 0, W, H);
    }

    // Probability heatmap
    const dist = p.distribution;
    if (dist && p.overlays.heatmap) {
      if (!L.heat) {
        L.heat = document.createElement('canvas');
        L.heat.width = W;
        L.heat.height = H;
        L.heatData = L.heat.getContext('2d')!.createImageData(W, H);
      }
      const k = p.reducedMotion ? 1 : 0.14;
      let changed = false;
      if (!L.display || L.display.length !== dist.length) {
        L.display = new Float32Array(dist);
        changed = true;
      } else {
        const d = L.display;
        for (let i = 0; i < d.length; i++) {
          const diff = dist[i] - d[i];
          if (diff > 1e-9 || diff < -1e-9) {
            d[i] += diff * k;
            changed = true;
          }
        }
      }
      if (changed || L.lastOpacity !== p.heatmapOpacity) {
        L.lastOpacity = p.heatmapOpacity ?? 0.8;
        const d = L.display!;
        let mx = 0;
        for (let i = 0; i < d.length; i++) if (d[i] > mx) mx = d[i];
        L.displayMax = mx;
        const data = L.heatData!.data;
        for (let i = 0; i < d.length; i++) {
          const val = mx > 0 ? d[i] / mx : 0;
          const o = i * 4;
          if (val < 0.004) {
            data[o + 3] = 0;
            continue;
          }
          const t = Math.pow(val, 0.62);
          const li = Math.round(t * 255) * 3;
          data[o] = PROB_LUT[li];
          data[o + 1] = PROB_LUT[li + 1];
          data[o + 2] = PROB_LUT[li + 2];
          data[o + 3] = (0.18 + 0.82 * Math.min(1, t * 1.15)) * 255;
        }
        L.heat.getContext('2d')!.putImageData(L.heatData!, 0, 0);
        if (L.frame - L.isoFrame > 8 || !L.isoPath.length) {
          L.isoFrame = L.frame;
          const norm = new Float32Array(d.length);
          for (let i = 0; i < d.length; i++) norm[i] = mx > 0 ? d[i] / mx : 0;
          L.isoPath = [0.25, 0.5, 0.78].map((lv) => contourPath(norm, W, H, lv));
        }
      }
      ctx.globalAlpha = p.heatmapOpacity ?? 0.8;
      ctx.drawImage(L.heat, 0, 0, W, H);
      ctx.globalAlpha = 1;
      if (p.mode === 'probability' || p.overlays.heatmap) {
        L.isoPath.forEach((path, k2) => {
          ctx.strokeStyle = light ? `rgba(61,14,133,${0.18 + k2 * 0.14})` : `rgba(255,255,255,${0.12 + k2 * 0.12})`;
          ctx.lineWidth = px * (0.8 + k2 * 0.3);
          ctx.stroke(path);
        });
      }
    }

    // Cell ownership
    if (sim && env && p.overlays.ownership) {
      if (!L.own) {
        L.own = document.createElement('canvas');
        L.own.width = W * OWN_SCALE;
        L.own.height = H * OWN_SCALE;
      }
      if (L.ownVersion !== sim.version || L.ownSim !== sim) {
        L.ownVersion = sim.version;
        L.ownSim = sim;
        const oc = L.own.getContext('2d')!;
        const ow = W * OWN_SCALE;
        const img = oc.createImageData(ow, H * OWN_SCALE);
        const data = img.data;
        const cols = sim.drones.map((d) => hexToRgb(d.color));
        for (let cy = 0; cy < H; cy++)
          for (let cx = 0; cx < W; cx++) {
            const i = cy * W + cx;
            const o = sim.owner[i];
            if (o < 0) continue;
            const st = sim.cellStatus[i];
            const col = cols[o];
            if (!col) continue;
            for (let yy = 0; yy < OWN_SCALE; yy++)
              for (let xx = 0; xx < OWN_SCALE; xx++) {
                const q = ((cy * OWN_SCALE + yy) * ow + cx * OWN_SCALE + xx) * 4;
                let a: number;
                if (st === 1) a = xx === 0 || yy === 0 ? 150 : 88;
                else a = (xx + yy) % 4 === 0 ? 120 : 26;
                data[q] = col[0];
                data[q + 1] = col[1];
                data[q + 2] = col[2];
                data[q + 3] = a;
              }
          }
        oc.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(L.own, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
    }

    // Grid
    if (p.showGrid !== false && S >= 5) {
      const x0 = Math.max(0, Math.floor(-v.ox / S));
      const x1 = Math.min(W, Math.ceil((w - v.ox) / S));
      const y0 = Math.max(0, Math.floor(-v.oy / S));
      const y1 = Math.min(H, Math.ceil((h - v.oy) / S));
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        if (S < 12 && x % BLOCK) continue;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = y0; y <= y1; y++) {
        if (S < 12 && y % BLOCK) continue;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.strokeStyle = light ? 'rgba(16,24,40,0.10)' : 'rgba(232,239,245,0.07)';
      ctx.lineWidth = px;
      ctx.stroke();
    }

    // Search boundary + isochrones
    const boundarySrc = env?.searchArea ?? p.searchBoundary ?? null;
    if (boundarySrc && p.overlays.searchArea) {
      if (L.boundaryKey !== boundarySrc) {
        const f = new Float32Array(boundarySrc.length);
        for (let i = 0; i < f.length; i++) f[i] = boundarySrc[i];
        L.boundary = contourPath(f, W, H, 0.5);
        L.boundaryKey = boundarySrc;
      }
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineDashOffset = (-now / 80) * px;
      ctx.strokeStyle = light ? 'rgba(255,255,255,0.9)' : 'rgba(8,12,16,0.7)';
      ctx.lineWidth = 3.5 * px;
      ctx.stroke(L.boundary!);
      ctx.strokeStyle = light ? '#2556E8' : '#5BE0B8';
      ctx.lineWidth = 1.8 * px;
      ctx.stroke(L.boundary!);
      ctx.setLineDash([]);
    }
    if (env && sim && p.overlays.travelRange && L.rangePaths.length) {
      L.rangePaths.forEach((path, k2) => {
        ctx.setLineDash([2 * px, 3 * px]);
        ctx.strokeStyle = light ? `rgba(37,86,232,${0.4 + k2 * 0.15})` : `rgba(160,240,220,${0.35 + k2 * 0.15})`;
        ctx.lineWidth = 1.1 * px;
        ctx.stroke(path);
      });
      ctx.setLineDash([]);
    }

    // Trails
    if (p.overlays.trails) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const tr of g.trails) {
        ctx.beginPath();
        tr.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.strokeStyle = light ? 'rgba(255,255,255,0.85)' : 'rgba(15,12,8,0.55)';
        ctx.lineWidth = 3 * px;
        ctx.stroke();
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.strokeStyle = light ? '#9a5b2e' : '#ecd9a6';
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Custom routes
    if (p.routes) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const r of p.routes) {
        if (r.points.length < 2) continue;
        ctx.beginPath();
        r.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = ((r.width ?? 3) + 3) * px;
        ctx.stroke();
        if (r.dashed) ctx.setLineDash([8 * px, 5 * px]);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = (r.width ?? 3) * px;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Drone search boundaries (current + queued blocks)
    if (sim && env && p.overlays.droneBoundaries) {
      for (const d of sim.drones) {
        const blocks = [d.currentBlock, ...d.queue].filter((b) => b >= 0);
        blocks.forEach((bi, k2) => {
          const b = env.blocks[bi];
          ctx.setLineDash(k2 === 0 ? [] : [3 * px, 2 * px]);
          ctx.strokeStyle = rgba(d.color, k2 === 0 ? 0.95 : 0.6);
          ctx.lineWidth = (k2 === 0 ? 1.8 : 1.2) * px;
          ctx.strokeRect(b.bx * BLOCK + 0.1, b.by * BLOCK + 0.1, BLOCK - 0.2, BLOCK - 0.2);
        });
      }
      ctx.setLineDash([]);
    }

    // Auction highlight
    const lastAuction = sim?.auctions[sim.auctions.length - 1];
    if (sim && env && lastAuction && sim.status !== 'ready') {
      // Start a new highlight only once the previous one has played (readable at high speed).
      if (L.auctionId !== lastAuction.id && now - L.auctionStart > 1700) {
        L.auctionId = lastAuction.id;
        L.auctionStart = now;
      }
      const age = now - L.auctionStart;
      const shown = sim.auctions.find((a) => a.id === L.auctionId);
      if (shown && age < 2600) {
        const b = env.blocks[shown.blockIndex];
        const pulse = 0.5 + 0.5 * Math.sin(age / 90);
        const winner = sim.drones.find((d) => d.id === shown.winnerId);
        if (age < 1400) {
          for (const bid of shown.bids) {
            const d = sim.drones.find((x) => x.id === bid.droneId);
            if (!d) continue;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(b.center.x, b.center.y);
            ctx.setLineDash([2 * px, 3 * px]);
            ctx.strokeStyle = rgba(bid.color, 0.7 * (1 - age / 1400));
            ctx.lineWidth = 1.2 * px;
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        const fill = winner && age > 900 ? rgba(winner.color, 0.35 * (1 - (age - 900) / 1700)) : `rgba(255,255,255,${0.12 * pulse})`;
        ctx.fillStyle = fill;
        const grow = age > 900 ? Math.min(1, (age - 900) / 300) : 0;
        ctx.fillRect(b.bx * BLOCK - grow * 0.4, b.by * BLOCK - grow * 0.4, BLOCK + grow * 0.8, BLOCK + grow * 0.8);
        ctx.strokeStyle = winner && age > 900 ? winner.color : light ? `rgba(16,24,40,${0.5 + 0.4 * pulse})` : `rgba(255,255,255,${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(b.bx * BLOCK, b.by * BLOCK, BLOCK, BLOCK);
      }
    }

    // Interpolation factor for smooth drone motion
    const alpha = sim?.status === 'running' && !p.reducedMotion ? Math.min(1, Math.max(0, (now - tickTiming.last) / tickTiming.interval)) : 1;
    const dronePos = (d: SimState['drones'][number]) => ({ x: d.prevX + (d.x - d.prevX) * alpha, y: d.prevY + (d.y - d.prevY) * alpha });

    // Flight paths
    if (sim && p.overlays.flightPaths) {
      for (const d of sim.drones) {
        if (d.trail.length < 2) continue;
        ctx.beginPath();
        d.trail.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        const pos = dronePos(d);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = rgba(d.color, 0.55);
        ctx.lineWidth = 1.4 * px;
        ctx.stroke();
        if (d.path.length) {
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          d.path.forEach((wp) => ctx.lineTo(wp.x, wp.y));
          ctx.setLineDash([1.5 * px, 3 * px]);
          ctx.strokeStyle = rgba(d.color, 0.8);
          ctx.lineWidth = 1.2 * px;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Sensor footprints
    if (sim && p.overlays.drones) {
      for (const d of sim.drones) {
        if (d.status !== 'searching' && d.status !== 'en_route') continue;
        const pos = dronePos(d);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, d.footprint, 0, Math.PI * 2);
        ctx.fillStyle = rgba(d.color, d.status === 'searching' ? 0.2 : 0.08);
        ctx.fill();
        ctx.strokeStyle = rgba(d.color, 0.6);
        ctx.lineWidth = px;
        ctx.stroke();
      }
    }

    // Estimated location (posterior mean + 1σ/2σ ellipse)
    if (sim && p.overlays.estimatedLocation) {
      const st = sim.stats;
      ctx.save();
      ctx.translate(st.mean.x, st.mean.y);
      ctx.rotate(st.ellipse.angle);
      for (const k2 of [2, 1]) {
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(0.5, st.ellipse.rx * k2), Math.max(0.5, st.ellipse.ry * k2), 0, 0, Math.PI * 2);
        ctx.setLineDash(k2 === 2 ? [4 * px, 3 * px] : []);
        ctx.strokeStyle = k2 === 2 ? 'rgba(91,33,182,0.45)' : 'rgba(91,33,182,0.8)';
        ctx.lineWidth = 1.4 * px;
        ctx.stroke();
      }
      ctx.restore();
      ctx.setLineDash([]);
    }

    // Selected / hovered cell
    const hv = hoverRef.current;
    if (hv) {
      ctx.strokeStyle = light ? 'rgba(16,24,40,0.75)' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.2 * px;
      ctx.strokeRect(hv.x, hv.y, 1, 1);
    }
    if (p.selectedCell) {
      ctx.strokeStyle = '#2556E8';
      ctx.lineWidth = 2.2 * px;
      ctx.strokeRect(p.selectedCell.x, p.selectedCell.y, 1, 1);
    }

    // ----- Screen-space glyphs -----
    screen();
    if (p.overlays.trails) {
      for (const lm of g.landmarks) {
        const sx = toSx(lm.x);
        const sy = toSy(lm.y);
        if (sx < -50 || sy < -20 || sx > w + 50 || sy > h + 20) continue;
        drawLandmark(ctx, sx, sy, lm.type, lm.name, S > 3.2 || lm.type === 'ranger' || lm.type === 'trailhead');
      }
      if (S > 5) {
        ctx.font = 'italic 600 10px "Inter Variable", Inter, sans-serif';
        for (const tr of g.trails) {
          const mid = tr.points[Math.floor(tr.points.length * 0.35)];
          if (!mid) continue;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.strokeText(tr.name, toSx(mid.x) + 6, toSy(mid.y) - 6);
          ctx.fillStyle = '#7a4a24';
          ctx.fillText(tr.name, toSx(mid.x) + 6, toSy(mid.y) - 6);
        }
      }
    }

    if (sim && env && p.overlays.estimatedLocation) {
      const sx = toSx(sim.stats.mean.x);
      const sy = toSy(sim.stats.mean.y);
      ctx.strokeStyle = '#5B21B6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy);
      ctx.lineTo(sx - 3, sy);
      ctx.moveTo(sx + 3, sy);
      ctx.lineTo(sx + 9, sy);
      ctx.moveTo(sx, sy - 9);
      ctx.lineTo(sx, sy - 3);
      ctx.moveTo(sx, sy + 3);
      ctx.lineTo(sx, sy + 9);
      ctx.stroke();
      ctx.font = '700 9px "Inter Variable", Inter, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText('BEST GUESS', sx + 11, sy + 14);
      ctx.fillStyle = '#5B21B6';
      ctx.fillText('BEST GUESS', sx + 11, sy + 14);
      // Peak cell marker
      const pk = sim.stats.peak;
      const pxx = toSx(pk.x + 0.5);
      const pyy = toSy(pk.y + 0.5);
      ctx.beginPath();
      ctx.arc(pxx, pyy, 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (sim && p.overlays.drones) {
      for (const d of sim.drones) {
        const pos = dronePos(d);
        drawDrone(ctx, toSx(pos.x), toSy(pos.y), d.heading, d.color, d.id, d.status, d.id === p.selectedDroneId, now);
      }
    }

    const lkp = env?.lkp ?? p.lkp;
    if (lkp && p.overlays.lkp) {
      const ll = cellToLatLon(g, lkp.x + 0.5, lkp.y + 0.5);
      drawLkp(ctx, toSx(lkp.x + 0.5), toSy(lkp.y + 0.5), formatLatLon(ll.latitude, ll.longitude), p.reducedMotion ? 0 : now, true);
    }

    for (const f of p.foundMarkers ?? []) drawFoundMarker(ctx, toSx(f.x), toSy(f.y), f.title, f.sub);
    for (const pin of p.pins ?? []) drawPin(ctx, toSx(pin.x), toSy(pin.y), pin.label, pin.color);

    if (sim) {
      for (const sig of sim.signals) {
        drawSignal(ctx, toSx(sig.x), toSy(sig.y), sig.status, `${sig.id} · ${(sig.confidence * 100).toFixed(0)}%`, now);
      }
    }

    // Scale bar
    {
      const mPerPx = g.cellSizeM / S;
      const nice = [50, 100, 200, 250, 500, 1000, 2000, 5000];
      const target = 110 * mPerPx;
      const len = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
      const bw = len / mPerPx;
      const bx = 14;
      const by = h - 18;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      roundRect(ctx, bx - 6, by - 16, bw + 12, 24, 4);
      ctx.fill();
      ctx.strokeStyle = '#101828';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by - 4);
      ctx.stroke();
      ctx.fillStyle = '#101828';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx + 2, by - 6);
    }
    // North arrow
    {
      const nx = w - 26;
      const ny = 26;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(nx, ny, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(nx, ny - 9);
      ctx.lineTo(nx + 5, ny + 4);
      ctx.lineTo(nx, ny + 1);
      ctx.lineTo(nx - 5, ny + 4);
      ctx.closePath();
      ctx.fillStyle = '#101828';
      ctx.fill();
      ctx.font = '700 8px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('N', nx, ny + 12);
      ctx.textAlign = 'left';
    }

    if (p.showMinimap !== false && L.frame % 3 === 0) renderMinimap(now);
  }

  function renderMinimap(now: number) {
    const mc = miniRef.current;
    if (!mc) return;
    const p = propsRef.current;
    const g = p.grid;
    const mw = mc.width;
    const mh = mc.height;
    const ctx = mc.getContext('2d')!;
    const sc = Math.min(mw / g.width, mh / g.height);
    const ox = (mw - g.width * sc) / 2;
    const oy = (mh - g.height * sc) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e9eef0';
    ctx.fillRect(0, 0, mw, mh);
    ctx.setTransform(sc, 0, 0, sc, ox, oy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(getRaster(g, p.mode === 'probability' ? 'terrain' : p.mode), 0, 0, g.width, g.height);
    const L = layers.current;
    if (L.heat && p.distribution && p.overlays.heatmap) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(L.heat, 0, 0, g.width, g.height);
      ctx.globalAlpha = 1;
    }
    if (L.boundary) {
      ctx.strokeStyle = '#2556E8';
      ctx.lineWidth = 1.2 / sc;
      ctx.stroke(L.boundary);
    }
    const sim = p.sim;
    if (sim) {
      for (const d of sim.drones) {
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - 1.2, d.y - 1.2, 2.4, 2.4);
      }
      for (const s of sim.signals) {
        if (s.status === 'pending' || s.status === 'verifying' || s.status === 'confirmed') {
          ctx.fillStyle = s.status === 'confirmed' ? '#0E9F6E' : '#E5364B';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2.4 + Math.sin(now / 200), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const lkp = p.env?.lkp ?? p.lkp;
    if (lkp) {
      ctx.fillStyle = '#F26B1D';
      ctx.beginPath();
      ctx.arc(lkp.x + 0.5, lkp.y + 0.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    ctx.strokeStyle = '#101828';
    ctx.lineWidth = 1.2 / sc;
    ctx.strokeRect(-v.ox / v.scale, -v.oy / v.scale, w / v.scale, h / v.scale);
  }

  // ---- interaction -------------------------------------------------------------------------
  const screenToCell = (clientX: number, clientY: number) => {
    const r = containerRef.current!.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const v = viewRef.current;
    return { wx: (sx - v.ox) / v.scale, wy: (sy - v.oy) / v.scale, sx, sy };
  };

  const zoomAt = (factor: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const ns = Math.min(48, Math.max(fitRef.current * 0.7, v.scale * factor));
    const wx = (sx - v.ox) / v.scale;
    const wy = (sy - v.oy) / v.scale;
    fittedRef.current = false;
    viewRef.current = clampView({ scale: ns, ox: sx - wx * ns, oy: sy - wy * ns });
    animRef.current = null;
    setZoomTick((z) => z + 1);
  };

  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: viewRef.current.ox, oy: viewRef.current.oy, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) {
        fittedRef.current = false;
        viewRef.current = clampView({ scale: viewRef.current.scale, ox: d.ox + dx, oy: d.oy + dy });
        animRef.current = null;
        if (hoverRef.current) setHover(null);
        return;
      }
    }
    const { wx, wy, sx, sy } = screenToCell(e.clientX, e.clientY);
    const g = propsRef.current.grid;
    const cx = Math.floor(wx);
    const cy = Math.floor(wy);
    if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) {
      if (hoverRef.current) setHover(null);
      return;
    }
    const hv = hoverRef.current;
    if (!hv || hv.x !== cx || hv.y !== cy || Math.abs(hv.sx - sx) > 30 || Math.abs(hv.sy - sy) > 30) setHover({ x: cx, y: cy, sx, sy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    const p = propsRef.current;
    const { wx, wy, sx, sy } = screenToCell(e.clientX, e.clientY);
    const v = viewRef.current;
    // Drone hit-test (screen space)
    if (p.sim && p.overlays.drones) {
      let best: string | null = null;
      let bd = 18;
      for (const dr of p.sim.drones) {
        const dd = Math.hypot(v.ox + dr.x * v.scale - sx, v.oy + dr.y * v.scale - sy);
        if (dd < bd) {
          bd = dd;
          best = dr.id;
        }
      }
      if (best) {
        p.onSelectDrone?.(best);
        return;
      }
      for (const sig of p.sim.signals) {
        if (Math.hypot(v.ox + sig.x * v.scale - sx, v.oy + sig.y * v.scale - sy) < 14) {
          p.onSelectSignal?.(sig.id);
          return;
        }
      }
    }
    const cx = Math.floor(wx);
    const cy = Math.floor(wy);
    if (cx < 0 || cy < 0 || cx >= p.grid.width || cy >= p.grid.height) {
      p.onSelectCell?.(null);
      return;
    }
    p.onSelectDrone?.(null);
    p.onSelectCell?.({ x: cx, y: cy });
  };

  const onMiniPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    const mc = miniRef.current!;
    const r = mc.getBoundingClientRect();
    const g = propsRef.current.grid;
    const sc = Math.min(mc.width / g.width, mc.height / g.height);
    const ox = (mc.width - g.width * sc) / 2;
    const oy = (mc.height - g.height * sc) / 2;
    const wx = ((e.clientX - r.left) * (mc.width / r.width) - ox) / sc;
    const wy = ((e.clientY - r.top) * (mc.height / r.height) - oy) / sc;
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    fittedRef.current = false;
    viewRef.current = clampView({ scale: v.scale, ox: w / 2 - wx * v.scale, oy: h / 2 - wy * v.scale });
    animRef.current = null;
  };

  const hoverLL = hover ? cellToLatLon(props.grid, hover.x + 0.5, hover.y + 0.5) : null;
  const { w: cw, h: ch } = sizeRef.current;

  return (
    <div ref={containerRef} className="relative h-full w-full select-none overflow-hidden bg-[#e9eef0]" onPointerLeave={() => setHover(null)}>
      <canvas
        ref={canvasRef}
        className={dragRef.current?.moved ? 'cursor-grabbing' : 'cursor-crosshair'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {hover && props.renderTooltip && (
        <div
          className="pointer-events-none absolute z-20 animate-fadeIn"
          style={{
            left: Math.min(hover.sx + 16, cw - 250),
            top: hover.sy + 16 > ch - 190 ? hover.sy - 190 : hover.sy + 16,
          }}
        >
          {props.renderTooltip(hover.x, hover.y)}
        </div>
      )}
      {/* Zoom controls */}
      <div className="absolute right-3 top-12 z-10 flex flex-col overflow-hidden rounded-lg border border-line bg-base/85 backdrop-blur">
        <button className="p-1.5 text-muted hover:bg-elevated hover:text-ink" title="Zoom in" onClick={() => zoomAt(1.4, cw / 2, ch / 2)}>
          <Plus size={15} />
        </button>
        <button className="border-t border-line p-1.5 text-muted hover:bg-elevated hover:text-ink" title="Zoom out" onClick={() => zoomAt(1 / 1.4, cw / 2, ch / 2)}>
          <Minus size={15} />
        </button>
        <button className="border-t border-line p-1.5 text-muted hover:bg-elevated hover:text-ink" title="Fit search environment" onClick={() => fitView(true)}>
          <Crosshair size={15} />
        </button>
      </div>
      {/* Cursor readout */}
      <div className="pointer-events-none absolute bottom-2.5 left-1/2 z-10 -translate-x-1/2 rounded-md border border-line/70 bg-base/80 px-2.5 py-1 font-mono text-2xs text-muted backdrop-blur">
        {hover && hoverLL ? (
          <>
            CELL <span className="text-ink">({hover.x}, {hover.y})</span> · <span className="text-ink">{formatLatLon(hoverLL.latitude, hoverLL.longitude)}</span> · ELEV{' '}
            <span className="text-ink">{Math.round(props.grid.elevation[hover.y * props.grid.width + hover.x]).toLocaleString()} m</span>
          </>
        ) : (
          <>Click a spot for details · scroll to zoom · drag to pan · simulated terrain</>
        )}
      </div>
      {props.showMinimap !== false && (
        <div className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-lg border border-line bg-base/90 shadow-lg shadow-black/40">
          <div className="flex items-center justify-between border-b border-line px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-muted">
            <span>Overview</span>
            <span className="font-mono">{viewRef.current.scale ? `${(viewRef.current.scale / fitRef.current).toFixed(1)}×` : ''}</span>
          </div>
          <canvas ref={miniRef} width={180} height={126} className="block h-[126px] w-[180px] cursor-pointer" onPointerDown={onMiniPointer} onPointerMove={onMiniPointer} />
        </div>
      )}
      {props.children}
    </div>
  );
}
