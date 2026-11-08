import { useEffect, useRef } from 'react';
import { bakeRamp } from '../../lib/colors';
import { hash2, valueNoise } from '../../lib/noise';

const IRON = bakeRamp([
  [0, '#05030c'],
  [0.3, '#3b0f6f'],
  [0.55, '#b5306b'],
  [0.75, '#f5752a'],
  [0.9, '#fbd14b'],
  [1, '#fffbe6'],
]);

/** Mock radiometric thermal still for a detection signal (procedural — not real imagery). */
export default function ThermalFrame({ seed, humanLike, width = 200, height = 130 }: { seed: number; humanLike: boolean; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    const cx = width * (0.45 + hash2(seed, 1, 3) * 0.1);
    const cy = height * (0.45 + hash2(seed, 2, 3) * 0.1);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let t = 0.18 + valueNoise(x * 0.05, y * 0.05, seed) * 0.22 + valueNoise(x * 0.2, y * 0.2, seed + 3) * 0.06;
        // canopy shadows
        t -= Math.max(0, valueNoise(x * 0.09, y * 0.09, seed + 7) - 0.55) * 0.5;
        let dx = (x - cx) / (humanLike ? 7 : 16);
        let dy = (y - cy) / (humanLike ? 15 : 7);
        if (!humanLike) {
          // elongated quadruped-like return with a second lobe
          const d2 = ((x - cx - 15) / 6) ** 2 + ((y - cy - 3) / 5) ** 2;
          t += Math.exp(-d2) * 0.45;
        } else {
          const head = ((x - cx) / 4.5) ** 2 + ((y - cy + 15) / 4.5) ** 2;
          t += Math.exp(-head) * 0.7;
        }
        const d = dx * dx + dy * dy;
        t += Math.exp(-d) * (humanLike ? 0.78 : 0.6);
        t += (hash2(x, y, seed) - 0.5) * 0.05;
        const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
        const o = (y * width + x) * 4;
        img.data[o] = IRON[i];
        img.data[o + 1] = IRON[i + 1];
        img.data[o + 2] = IRON[i + 2];
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 22, cy - 26, 44, 50);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${humanLike ? '36.4' : '38.9'}°C`, cx + 24, cy - 18);
    ctx.fillText('LWIR · SIM', 5, height - 6);
  }, [seed, humanLike, width, height]);
  return <canvas ref={ref} width={width} height={height} className="rounded-md border border-line" style={{ width, height, imageRendering: 'pixelated' }} />;
}
