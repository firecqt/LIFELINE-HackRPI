/** Screen-space canvas glyphs used by the terrain renderer. */
import type { LandmarkType } from '../../types/terrain';
import type { DroneStatus } from '../../types/drone';
import type { SignalStatus } from '../../types/simulation';
import { rgba } from '../../lib/colors';

export function drawDrone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  headingDeg: number,
  color: string,
  label: string,
  status: DroneStatus,
  selected: boolean,
  t: number,
) {
  const s = 10;
  ctx.save();
  ctx.translate(x, y);
  if (selected) {
    ctx.beginPath();
    ctx.arc(0, 0, s + 9, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -t * 0.02;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // shadow halo
  ctx.beginPath();
  ctx.arc(0, 0, s + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5,10,15,0.55)';
  ctx.fill();
  ctx.rotate((headingDeg * Math.PI) / 180);
  // arms
  ctx.strokeStyle = '#0b1118';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, -s * 0.72);
  ctx.lineTo(s * 0.72, s * 0.72);
  ctx.moveTo(s * 0.72, -s * 0.72);
  ctx.lineTo(-s * 0.72, s * 0.72);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // rotors
  const airborne = status !== 'standby' && status !== 'charging' && status !== 'maintenance' && status !== 'preparing';
  for (const [rx, ry] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const cx = rx * s * 0.72;
    const cy = ry * s * 0.72;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 1;
    ctx.stroke();
    if (airborne) {
      const a = t * 0.04 * (rx * ry);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * s * 0.32, cy + Math.sin(a) * s * 0.32);
      ctx.lineTo(cx - Math.cos(a) * s * 0.32, cy - Math.sin(a) * s * 0.32);
      ctx.strokeStyle = rgba(color, 0.7);
      ctx.stroke();
    }
  }
  // body + heading nose
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.62);
  ctx.lineTo(s * 0.32, s * 0.12);
  ctx.lineTo(0, s * 0.3);
  ctx.lineTo(-s * 0.32, s * 0.12);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#0b1118';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  // label
  ctx.font = '600 10px "JetBrains Mono", monospace';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  roundRect(ctx, x + s + 4, y - 8, w, 15, 3);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, x + s + 8, y + 3);
  if (status === 'low_battery' || status === 'returning') {
    ctx.fillStyle = status === 'low_battery' ? '#E5364B' : '#475569';
    ctx.beginPath();
    ctx.arc(x + s + w + 9, y - 0.5, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawLkp(ctx: CanvasRenderingContext2D, x: number, y: number, coords: string, t: number, showLabel: boolean) {
  for (let k = 0; k < 3; k++) {
    const phase = ((t / 1800 + k / 3) % 1 + 1) % 1;
    ctx.beginPath();
    ctx.arc(x, y, 10 + phase * 34, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(242,107,29,${0.75 * (1 - phase)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#F26B1D';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  // person glyph
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y - 4.5, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 4.2, y + 6);
  ctx.quadraticCurveTo(x - 4.2, y - 1.2, x, y - 1.2);
  ctx.quadraticCurveTo(x + 4.2, y - 1.2, x + 4.2, y + 6);
  ctx.closePath();
  ctx.fill();
  if (!showLabel) return;
  ctx.font = '700 10px Inter, sans-serif';
  const title = 'LAST KNOWN POSITION';
  ctx.font = '700 10px "Inter Variable", Inter, sans-serif';
  const w1 = ctx.measureText(title).width;
  ctx.font = '500 10px "JetBrains Mono", monospace';
  const w2 = ctx.measureText(coords).width;
  const w = Math.max(w1, w2) + 14;
  const bx = x + 18;
  const by = y - 34;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, bx, by, w, 32, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(242,107,29,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 9, y - 7);
  ctx.lineTo(bx, by + 24);
  ctx.stroke();
  ctx.fillStyle = '#D9560F';
  ctx.font = '700 10px "Inter Variable", Inter, sans-serif';
  ctx.fillText(title, bx + 7, by + 13);
  ctx.fillStyle = '#101828';
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.fillText(coords, bx + 7, by + 26);
}

const LANDMARK_GLYPH: Record<LandmarkType, string> = { peak: '▲', lake: '≈', trailhead: 'T', ranger: 'R', overlook: '◉', camp: '⌂' };

export function drawLandmark(ctx: CanvasRenderingContext2D, x: number, y: number, type: LandmarkType, name: string, showName: boolean) {
  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = type === 'ranger' ? 'rgba(47,111,214,0.95)' : 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.strokeStyle = type === 'ranger' ? '#ffffff' : '#7a6a4a';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = type === 'ranger' ? '#ffffff' : '#5c4f36';
  ctx.font = '700 9px "Inter Variable", Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(LANDMARK_GLYPH[type], x, y + 3.2);
  ctx.textAlign = 'left';
  if (!showName) return;
  ctx.font = '600 10px "Inter Variable", Inter, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(name, x + 11, y + 3.5);
  ctx.fillStyle = '#3d3527';
  ctx.fillText(name, x + 11, y + 3.5);
}

const SIGNAL_COLORS: Record<SignalStatus, string> = {
  pending: '#E5364B',
  verifying: '#C88A04',
  on_scene: '#C88A04',
  confirmed: '#0E9F6E',
  not_subject: '#94A3B8',
  false_positive: '#94A3B8',
  dismissed: '#94A3B8',
};

export function drawSignal(ctx: CanvasRenderingContext2D, x: number, y: number, status: SignalStatus, label: string, t: number) {
  const c = SIGNAL_COLORS[status];
  if (status === 'pending' || status === 'verifying') {
    const phase = (t / 900) % 1;
    ctx.beginPath();
    ctx.arc(x, y, 8 + phase * 26, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(c, 0.9 * (1 - phase));
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = c;
  ctx.fillRect(-6.5, -6.5, 13, 13);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-6.5, -6.5, 13, 13);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = '800 10px "Inter Variable", Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(status === 'confirmed' ? '✓' : status === 'false_positive' || status === 'dismissed' ? '×' : '!', x, y + 3.5);
  ctx.textAlign = 'left';
  ctx.font = '600 10px "JetBrains Mono", monospace';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, x + 12, y + 6, w, 15, 3);
  ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = c;
  ctx.fillText(label, x + 16, y + 17);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Green pin marking where the subject was found, with a two-line label chip. */
export function drawFoundMarker(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, sub: string) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#0E9F6E';
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  // check mark
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 0.5);
  ctx.lineTo(x - 1.5, y + 4);
  ctx.lineTo(x + 5.5, y - 4);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.font = '700 10px "Inter Variable", Inter, sans-serif';
  const w1 = ctx.measureText(title).width;
  ctx.font = '500 10px "JetBrains Mono", monospace';
  const w2 = ctx.measureText(sub).width;
  const w = Math.max(w1, w2) + 14;
  const bx = x + 18;
  const by = y - 34;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  roundRect(ctx, bx, by, w, 32, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(14,159,110,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 9, y - 7);
  ctx.lineTo(bx, by + 24);
  ctx.stroke();
  ctx.fillStyle = '#0E9F6E';
  ctx.font = '700 10px "Inter Variable", Inter, sans-serif';
  ctx.fillText(title, bx + 7, by + 13);
  ctx.fillStyle = '#101828';
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.fillText(sub, bx + 7, by + 26);
}
