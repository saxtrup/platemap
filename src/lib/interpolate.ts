import { solveLinear } from "./geometry";

export type Sample = { x: number; y: number; z: number };
export type ScalarField = (x: number, y: number) => number;

function phi(r2: number): number {
  if (r2 < 1e-18) return 0;
  return 0.5 * r2 * Math.log(r2);
}

function idw(pts: Sample[], power = 3): ScalarField {
  return (x, y) => {
    let num = 0;
    let den = 0;
    for (const p of pts) {
      const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d2 < 1e-14) return p.z;
      const w = 1 / d2 ** (power / 2);
      num += w * p.z;
      den += w;
    }
    return den > 0 ? num / den : 0;
  };
}

function clampField(fn: ScalarField, pts: Sample[]): ScalarField {
  if (pts.length === 0) return fn;
  let zmin = Infinity;
  let zmax = -Infinity;
  for (const p of pts) {
    if (p.z < zmin) zmin = p.z;
    if (p.z > zmax) zmax = p.z;
  }
  const span = Math.max(0.05, zmax - zmin);
  const lo = zmin - span * 0.35;
  const hi = zmax + span * 0.35;
  return (x, y) => {
    const v = fn(x, y);
    if (!Number.isFinite(v)) return 0;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  };
}

/** Thin-plate spline interpolant with a linear polynomial. Falls back to IDW. */
export function makeTps(pts: Sample[]): ScalarField {
  const n = pts.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => pts[0]!.z;
  if (n === 2) return clampField(idw(pts), pts);

  const N = n + 3;
  const A: number[][] = new Array(N);
  for (let i = 0; i < N; i++) A[i] = new Array(N).fill(0);
  const b = new Array<number>(N).fill(0);

  let meanPhi = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const pi = pts[i]!;
    for (let j = i + 1; j < n; j++) {
      const pj = pts[j]!;
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const v = phi(dx * dx + dy * dy);
      A[i]![j] = v;
      A[j]![i] = v;
      meanPhi += v;
      cnt += 1;
    }
    A[i]![n] = 1;
    A[i]![n + 1] = pi.x;
    A[i]![n + 2] = pi.y;
    A[n]![i] = 1;
    A[n + 1]![i] = pi.x;
    A[n + 2]![i] = pi.y;
    b[i] = pi.z;
  }
  const lambda = (cnt > 0 ? meanPhi / cnt : 1) * 6e-3;
  for (let i = 0; i < n; i++) A[i]![i] = lambda;

  const w = solveLinear(A, b);
  if (!w) return clampField(idw(pts), pts);

  const weights = w;
  const raw: ScalarField = (x, y) => {
    let s = weights[n]! + weights[n + 1]! * x + weights[n + 2]! * y;
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const dx = x - p.x;
      const dy = y - p.y;
      s += weights[i]! * phi(dx * dx + dy * dy);
    }
    return s;
  };
  return clampField(raw, pts);
}

export type HeightGrid = {
  size: number;
  /** Row-major, NaN outside the disc. y decreases downward (canvas). */
  z: Float64Array;
};

export function sampleGrid(field: ScalarField, size: number, _idFrac = 0): HeightGrid {
  const z = new Float64Array(size * size);
  const last = size - 1 || 1;
  for (let j = 0; j < size; j++) {
    const y = 1 - (2 * j) / last;
    for (let i = 0; i < size; i++) {
      const x = (2 * i) / last - 1;
      const idx = j * size + i;
      const r2 = x * x + y * y;
      if (r2 > 1.002) {
        z[idx] = Number.NaN;
      } else {
        z[idx] = field(x, y);
      }
    }
  }
  return { size, z };
}

export function gridAt(grid: HeightGrid, i: number, j: number): number {
  return grid.z[j * grid.size + i]!;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const a = values.slice().sort((x, y) => x - y);
  const t = (p / 100) * (a.length - 1);
  const lo = Math.floor(t);
  const hi = Math.ceil(t);
  if (lo === hi) return a[lo]!;
  return a[lo]! * (hi - t) + a[hi]! * (t - lo);
}
