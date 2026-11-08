import { useEffect, useRef } from 'react';
import type { MissingPersonReport } from '../../types/mission';
import { parkById } from '../../data/mockParks';
import { getTerrain } from '../../services/terrainService';
import { getRaster } from '../terrain/rasterizer';

/** Static preview of the (simulated) terrain around a report's last known position. */
export default function MapPreview({ report, height = 200 }: { report: MissingPersonReport; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const w = c.clientWidth;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    const g = getTerrain(parkById(report.parkId), report.id, report.lkp);
    const raster = getRaster(g, 'terrain');
    // Crop around the LKP
    const span = 70;
    const aspect = w / height;
    const cw = span * aspect;
    const ch = span;
    const x0 = Math.max(0, Math.min(g.width - cw, g.anchor.x - cw / 2));
    const y0 = Math.max(0, Math.min(g.height - ch, g.anchor.y - ch / 2));
    const s = (w * dpr) / cw;
    ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(raster, 0, 0, g.width, g.height);
    // trails
    ctx.lineWidth = 0.35;
    ctx.setLineDash([0.8, 0.5]);
    ctx.strokeStyle = '#9a5b2e';
    for (const t of g.trails) {
      ctx.beginPath();
      t.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // initial search radius
    const rCells = (report.initialRadiusKm * 1000) / g.cellSizeM;
    const lx = g.anchor.x + 0.5;
    const ly = g.anchor.y + 0.5;
    ctx.beginPath();
    ctx.arc(lx, ly, Math.min(rCells, 60), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(37,86,232,0.08)';
    ctx.fill();
    ctx.setLineDash([1.5, 1]);
    ctx.strokeStyle = 'rgba(37,86,232,0.85)';
    ctx.lineWidth = 0.3;
    ctx.stroke();
    ctx.setLineDash([]);
    // LKP marker in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = ((lx - x0) * s) / dpr;
    const sy = ((ly - y0) * s) / dpr;
    for (const [r, a] of [
      [22, 0.18],
      [14, 0.35],
    ]) {
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(242,107,29,${a})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#F26B1D';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '700 10px "Inter Variable", Inter, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText('LAST SEEN', sx + 11, sy + 4);
    ctx.fillStyle = '#fff';
    ctx.fillText('LKP', sx + 11, sy + 4);
    ctx.fillStyle = 'rgba(8,12,16,0.75)';
    ctx.fillRect(6, height - 22, 168, 16);
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#5F6B7D';
    ctx.fillText(`r = ${report.initialRadiusKm} km initial · SIMULATED`, 10, height - 10);
  }, [report, height]);
  return <canvas ref={ref} className="block w-full rounded-lg border border-line" style={{ height }} />;
}
