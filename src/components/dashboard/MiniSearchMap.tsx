/**
 * MiniSearchMap — a small live thumbnail of one search: terrain cropped to the search area,
 * the probability shading, drones, last-seen point and any sightings. Redraws ~1×/s.
 */
import { useEffect, useRef } from 'react';
import type { Session } from '../../store/appStore';
import { getRaster } from '../terrain/rasterizer';
import { PROB_LUT } from '../../lib/colors';
import { AIRBORNE_STATUSES } from '../../services/droneService';

export default function MiniSearchMap({ session, height = 132 }: { session: Session; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sessRef = useRef(session);
  sessRef.current = session;

  useEffect(() => {
    const heat = document.createElement('canvas');
    let bbox: { x0: number; y0: number; w: number; h: number } | null = null;
    let lastVersion = -1;

    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const { env, sim } = sessRef.current;
      if (sim.version === lastVersion) return;
      lastVersion = sim.version;
      const g = env.grid;
      const W = g.width;
      if (!bbox) {
        let x0 = W;
        let y0 = g.height;
        let x1 = 0;
        let y1 = 0;
        env.searchArea.forEach((v, i) => {
          if (!v) return;
          const x = i % W;
          const y = (i / W) | 0;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + 1);
          y1 = Math.max(y1, y + 1);
        });
        const pad = 4;
        bbox = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), w: Math.min(W, x1 + pad) - Math.max(0, x0 - pad), h: Math.min(g.height, y1 + pad) - Math.max(0, y0 - pad) };
        heat.width = W;
        heat.height = g.height;
      }
      const dpr = window.devicePixelRatio || 1;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (c.width !== cw * dpr) {
        c.width = cw * dpr;
        c.height = ch * dpr;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Cover-fit the bbox into the canvas.
      const s = Math.max(cw / bbox.w, ch / bbox.h);
      const ox = (cw - bbox.w * s) / 2 - bbox.x0 * s;
      const oy = (ch - bbox.h * s) / 2 - bbox.y0 * s;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(getRaster(g, 'terrain'), ox, oy, W * s, g.height * s);

      // Probability shading
      const p = sim.probability;
      let mx = 0;
      for (let i = 0; i < p.length; i++) if (p[i] > mx) mx = p[i];
      const hctx = heat.getContext('2d')!;
      const img = hctx.createImageData(W, g.height);
      for (let i = 0; i < p.length; i++) {
        const v = mx > 0 ? p[i] / mx : 0;
        if (v < 0.01) continue;
        const t = Math.pow(v, 0.62);
        const li = Math.round(t * 255) * 3;
        img.data[i * 4] = PROB_LUT[li];
        img.data[i * 4 + 1] = PROB_LUT[li + 1];
        img.data[i * 4 + 2] = PROB_LUT[li + 2];
        img.data[i * 4 + 3] = (0.15 + 0.75 * t) * 255;
      }
      hctx.putImageData(img, 0, 0);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(heat, ox, oy, W * s, g.height * s);
      ctx.globalAlpha = 1;

      const sx = (x: number) => ox + x * s;
      const sy = (y: number) => oy + y * s;
      // Last seen
      ctx.beginPath();
      ctx.arc(sx(env.lkp.x + 0.5), sy(env.lkp.y + 0.5), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#F26B1D';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Drones
      for (const d of sim.drones) {
        if (!AIRBORNE_STATUSES.includes(d.status)) continue;
        ctx.beginPath();
        ctx.arc(sx(d.x), sy(d.y), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx(d.x), sy(d.y), 2, 0, Math.PI * 2);
        ctx.fillStyle = '#1E3A8A';
        ctx.fill();
      }
      // Sightings / find
      for (const sig of sim.signals) {
        if (sig.status !== 'pending' && sig.status !== 'verifying' && sig.status !== 'on_scene' && sig.status !== 'confirmed') continue;
        ctx.beginPath();
        ctx.arc(sx(sig.x), sy(sig.y), 5, 0, Math.PI * 2);
        ctx.fillStyle = sig.status === 'confirmed' ? '#0E9F6E' : '#E5364B';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };
    draw();
    const id = window.setInterval(draw, 1000);
    return () => clearInterval(id);
  }, []);

  return <canvas ref={ref} className="block w-full" style={{ height }} />;
}
