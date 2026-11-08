/**
 * Marching-squares isoline extraction. Returns a Path2D in world (cell) units where
 * cell (x, y) spans [x, x+1] x [y, y+1] and the sample sits at the cell center.
 */
export function contourPath(field: ArrayLike<number>, w: number, h: number, level: number): Path2D {
  const path = new Path2D();
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = field[y * w + x];
      const b = field[y * w + x + 1];
      const c = field[(y + 1) * w + x + 1];
      const d = field[(y + 1) * w + x];
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const tT = (level - a) / (b - a || 1e-9);
      const tR = (level - b) / (c - b || 1e-9);
      const tB = (level - d) / (c - d || 1e-9);
      const tL = (level - a) / (d - a || 1e-9);
      const T = [x + tT, y];
      const R = [x + 1, y + tR];
      const B = [x + tB, y + 1];
      const L = [x, y + tL];
      let pairs: number[][][];
      switch (idx) {
        case 1:
        case 14:
          pairs = [[L, B]];
          break;
        case 2:
        case 13:
          pairs = [[B, R]];
          break;
        case 3:
        case 12:
          pairs = [[L, R]];
          break;
        case 4:
        case 11:
          pairs = [[T, R]];
          break;
        case 5:
          pairs = [[L, B], [T, R]];
          break;
        case 6:
        case 9:
          pairs = [[T, B]];
          break;
        case 7:
        case 8:
          pairs = [[L, T]];
          break;
        default:
          pairs = [[L, T], [B, R]];
      }
      for (const [p, q] of pairs) {
        path.moveTo(p[0] + 0.5, p[1] + 0.5);
        path.lineTo(q[0] + 0.5, q[1] + 0.5);
      }
    }
  }
  return path;
}
