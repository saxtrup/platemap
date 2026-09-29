import type { HeightGrid } from "./interpolate";
import { gridAt } from "./interpolate";

export type Polyline = { x: number; y: number }[];
export type ContourSet = { level: number; lines: Polyline[] };

function lerp(a: number, b: number, ta: number, tb: number, level: number): number {
  const d = tb - ta;
  if (Math.abs(d) < 1e-12) return (a + b) / 2;
  return a + ((level - ta) / d) * (b - a);
}

function straddles(a: number, b: number, level: number): boolean {
  return a >= level !== b >= level;
}

/**
 * Marching squares on a unit-circle grid. Coordinates in radius-fraction, y up.
 * Grid rows increase downward (canvas convention).
 */
export function marchingSquares(grid: HeightGrid, levels: number[]): ContourSet[] {
  const { size } = grid;
  const last = size - 1 || 1;
  const out: ContourSet[] = [];

  for (const level of levels) {
    const segs: [number, number, number, number][] = [];
    for (let j = 0; j < size - 1; j++) {
      const y0 = 1 - (2 * j) / last;
      const y1 = 1 - (2 * (j + 1)) / last;
      for (let i = 0; i < size - 1; i++) {
        const tl = gridAt(grid, i, j);
        const tr = gridAt(grid, i + 1, j);
        const bl = gridAt(grid, i, j + 1);
        const br = gridAt(grid, i + 1, j + 1);
        if (![tl, tr, bl, br].every(Number.isFinite)) continue;
        const x0 = (2 * i) / last - 1;
        const x1 = (2 * (i + 1)) / last - 1;
        const pts: { x: number; y: number }[] = [];
        if (straddles(tl, tr, level)) pts.push({ x: lerp(x0, x1, tl, tr, level), y: y0 });
        if (straddles(tr, br, level)) pts.push({ x: x1, y: lerp(y0, y1, tr, br, level) });
        if (straddles(br, bl, level)) pts.push({ x: lerp(x1, x0, br, bl, level), y: y1 });
        if (straddles(bl, tl, level)) pts.push({ x: x0, y: lerp(y1, y0, bl, tl, level) });
        if (pts.length === 2) {
          segs.push([pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y]);
        } else if (pts.length === 4) {
          segs.push([pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y]);
          segs.push([pts[2]!.x, pts[2]!.y, pts[3]!.x, pts[3]!.y]);
        }
      }
    }
    out.push({ level, lines: stitch(segs) });
  }
  return out;
}

function stitch(segs: [number, number, number, number][]): Polyline[] {
  if (segs.length === 0) return [];
  const key = (x: number, y: number) => `${x.toFixed(5)},${y.toFixed(5)}`;
  const used = new Uint8Array(segs.length);
  const adj = new Map<string, number[]>();
  const add = (k: string, i: number) => {
    const a = adj.get(k);
    if (a) a.push(i);
    else adj.set(k, [i]);
  };
  segs.forEach((s, i) => {
    add(key(s[0], s[1]), i);
    add(key(s[2], s[3]), i);
  });

  const lines: Polyline[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i]!;
    const pts: Polyline = [
      { x: s[0], y: s[1] },
      { x: s[2], y: s[3] },
    ];
    for (;;) {
      const last = pts[pts.length - 1]!;
      const cands = adj.get(key(last.x, last.y)) ?? [];
      let found = -1;
      for (const ci of cands) {
        if (!used[ci]) {
          found = ci;
          break;
        }
      }
      if (found < 0) break;
      used[found] = 1;
      const g = segs[found]!;
      const kLast = key(last.x, last.y);
      if (key(g[0], g[1]) === kLast) pts.push({ x: g[2], y: g[3] });
      else pts.push({ x: g[0], y: g[1] });
    }
    lines.push(pts);
  }
  return lines;
}

export function contourLevels(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.ceil((min + 1e-9) / step) * step;
  const hi = Math.floor((max - 1e-9) / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step * 0.5; v += step) {
    const r = Math.round(v / step) * step;
    out.push(Math.abs(r) < step * 0.25 ? 0 : Number(r.toFixed(6)));
    if (out.length > 48) break;
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
