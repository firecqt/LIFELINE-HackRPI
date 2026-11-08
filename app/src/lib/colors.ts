/** Color ramps shared by every renderer (map, legends, 3D surface, charts). */
export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Bake a ramp of [t, hex] stops into a 256-entry RGB lookup table. */
export function bakeRamp(stops: [number, string][]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const parsed = stops.map(([t, c]) => [t, hexToRgb(c)] as [number, RGB]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < parsed.length - 2 && t > parsed[k + 1][0]) k++;
    const [t0, c0] = parsed[k];
    const [t1, c1] = parsed[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * f;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * f;
  }
  return lut;
}

/** Violet heat ramp for search probability: distinct from alert reds and the hiker's orange. */
export const PROBABILITY_STOPS: [number, string][] = [
  [0, '#EFE4FF'],
  [0.3, '#C7A3FF'],
  [0.55, '#9A5CF5'],
  [0.8, '#6A2BD6'],
  [1, '#3D0E85'],
];
export const ELEVATION_STOPS: [number, string][] = [
  [0, '#1d4a2a'],
  [0.2, '#2f6b35'],
  [0.4, '#7fab5a'],
  [0.56, '#c8bd86'],
  [0.7, '#a77f55'],
  [0.84, '#7f6553'],
  [0.93, '#b8b1aa'],
  [1, '#f6f6f4'],
];
export const SLOPE_STOPS: [number, string][] = [
  [0, '#1f5c46'],
  [0.2, '#5aa65c'],
  [0.4, '#d9cf58'],
  [0.6, '#e5893b'],
  [0.8, '#c83e3e'],
  [1, '#7a2a6e'],
];

export const PROB_LUT = bakeRamp(PROBABILITY_STOPS);
export const ELEV_LUT = bakeRamp(ELEVATION_STOPS);
export const SLOPE_LUT = bakeRamp(SLOPE_STOPS);

export function lutColor(lut: Uint8ClampedArray, t: number): RGB {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return [lut[i], lut[i + 1], lut[i + 2]];
}

export function rampCss(stops: [number, string][], dir = 'to right'): string {
  return `linear-gradient(${dir}, ${stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ')})`;
}

export const VEGETATION_COLORS = ['#6b6f76', '#cfd986', '#8cc66a', '#3d9a50', '#1b6538'];
export const WATER_COLOR = '#2a5d8a';

/** Per-drone identity colors: blues, teals and greens that avoid the hiker orange, alert rose
 *  and probability violet so a drone never reads as an alert. */
export const DRONE_COLORS = [
  '#2556E8',
  '#0891B2',
  '#0F766E',
  '#4D7C0F',
  '#1E3A8A',
  '#0369A1',
  '#7C5E10',
  '#334155',
  '#15803D',
  '#1D4ED8',
  '#0E7490',
  '#3F6212',
];
