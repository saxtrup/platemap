import type { FlipKind, Job, Reading } from "./types";
import { fitPlane, formatClock, polarToXY, xyToPolar } from "./geometry";
import { makeTps, percentile, type ScalarField } from "./interpolate";

export type ScanSample = { offsetHours: number; rms: number; pv: number };

export type ParallelismResult = {
  ready: boolean;
  nA: number;
  nB: number;
  flip: FlipKind;
  offsetHours: number;
  /** RMS of (zA + zB) after plane removal — thickness scatter. */
  rms: number;
  /** Peak-to-valley of thickness deviation (parallelism). */
  thicknessPv: number;
  thicknessHigh: number;
  thicknessLow: number;
  /** Planar part of thickness, mm across the OD. */
  wedgeMm: number;
  wedgeDeg: number;
  wedgeClockHours: number;
  /** corr(zA, −zB). Near +1 means the faces are opposites (uniform thickness). */
  corr: number;
  flatnessA: number;
  flatnessB: number;
  scan: ScanSample[];
  field: ScalarField;
  colorScale: number;
  /** Face A residual, 1st-face coordinates. */
  formA: ScalarField;
  /** Face B residual, already mapped into 1st-face coordinates. */
  formB: ScalarField;
  formScale: number;
  /** 12:00 on face A maps to this clock on face B. */
  clockBAt12: number;
  altOffsetHours: number | null;
};

const EMPTY_FIELD: ScalarField = () => 0;

const COARSE = 48;
const GRID = 18;
const FINE_STEP = 0.05;
const FINE_SPAN = 0.5;

export const FLIP_LABEL: Record<FlipKind, string> = {
  none: "Rotate only",
  mirror12: "Flip 12–6",
  mirror39: "Flip 3–9",
};

export function wrapHours(h: number): number {
  let x = h % 12;
  if (x < 0) x += 12;
  return x;
}

/** Clockwise rotation of a point by `hours` on the 12-hour face. */
export function rotateXY(x: number, y: number, hours: number): { x: number; y: number } {
  const th = (hours / 12) * Math.PI * 2;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/** Map a 1st-face (x, y) into 2nd-face coordinates. */
export function mapToB(
  x: number,
  y: number,
  flip: FlipKind,
  offsetHours: number,
): { x: number; y: number } {
  const u = flip === "mirror12" ? -x : x;
  const v = flip === "mirror39" ? -y : y;
  return rotateXY(u, v, offsetHours);
}

/** Map a 2nd-face (x, y) back onto the 1st-face. */
export function mapFromB(
  x: number,
  y: number,
  flip: FlipKind,
  offsetHours: number,
): { x: number; y: number } {
  const p = rotateXY(x, y, -offsetHours);
  return {
    x: flip === "mirror12" ? -p.x : p.x,
    y: flip === "mirror39" ? -p.y : p.y,
  };
}

export function clockOnB(
  clockA: number,
  flip: FlipKind,
  offsetHours: number,
  rFrac = 1,
): number {
  const { x, y } = polarToXY(clockA, rFrac);
  const m = mapToB(x, y, flip, offsetHours);
  return xyToPolar(m.x, m.y).clockHours;
}

export function formatOffsetHours(h: number): string {
  const wrapped = wrapHours(h);
  const totalMin = Math.round(wrapped * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  const deg = wrapped * 30;
  if (hh === 0 && mm === 0) return `0 min · 0°`;
  if (hh === 0) return `+${mm} min · ${Math.round(deg)}°`;
  return `+${hh}:${mm.toString().padStart(2, "0")} cw · ${Math.round(deg)}°`;
}

export function formatCorrespondence(clockBAt12: number): string {
  return `12:00 on 1st  →  ${formatClock(clockBAt12)} on 2nd`;
}

function emptyResult(nA: number, nB: number): ParallelismResult {
  return {
    ready: false,
    nA,
    nB,
    flip: "none",
    offsetHours: 0,
    rms: 0,
    thicknessPv: 0,
    thicknessHigh: 0,
    thicknessLow: 0,
    wedgeMm: 0,
    wedgeDeg: 0,
    wedgeClockHours: 0,
    corr: 0,
    flatnessA: 0,
    flatnessB: 0,
    scan: [],
    field: EMPTY_FIELD,
    colorScale: 0.02,
    formA: EMPTY_FIELD,
    formB: EMPTY_FIELD,
    formScale: 0.02,
    clockBAt12: 0,
    altOffsetHours: null,
  };
}

type XYField = { field: ScalarField; flatness: number };

function residualField(points: Reading[], job: Job): XYField | null {
  if (points.length < 3) return null;
  const samples = points.map((p) => {
    const { x, y } = polarToXY(p.clockHours, p.rFrac);
    return { x, y, z: p.dial * job.dialUnitMm };
  });
  const plane = fitPlane(samples);
  const residual = samples.map((s) => ({
    x: s.x,
    y: s.y,
    z: plane ? s.z - (plane.a + plane.b * s.x + plane.c * s.y) : s.z,
  }));
  const zs = residual.map((s) => s.z);
  const flatness = zs.length ? Math.max(...zs) - Math.min(...zs) : 0;
  let field: ScalarField = EMPTY_FIELD;
  try {
    field = makeTps(residual);
  } catch {
    return { field: EMPTY_FIELD, flatness };
  }
  return { field, flatness };
}

function discSamples(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const last = n - 1 || 1;
  for (let j = 0; j < n; j++) {
    const y = 1 - (2 * j) / last;
    for (let i = 0; i < n; i++) {
      const x = (2 * i) / last - 1;
      if (x * x + y * y > 0.9) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function scoreAt(
  fieldA: ScalarField,
  fieldB: ScalarField,
  pts: { x: number; y: number }[],
  flip: FlipKind,
  offsetHours: number,
): { rms: number; pv: number; mean: number; corr: number; vals: number[]; za: number[]; zb: number[] } {
  const vals: number[] = [];
  const za: number[] = [];
  const zb: number[] = [];
  for (const p of pts) {
    const a = fieldA(p.x, p.y);
    const m = mapToB(p.x, p.y, flip, offsetHours);
    const b = fieldB(m.x, m.y);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    za.push(a);
    zb.push(b);
    vals.push(a + b);
  }
  if (vals.length < 8) {
    return { rms: Number.POSITIVE_INFINITY, pv: 0, mean: 0, corr: 0, vals, za, zb };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / vals.length;
  let varSum = 0;
  for (const v of vals) varSum += (v - mean) ** 2;
  const rms = Math.sqrt(varSum / vals.length);
  return { rms, pv: max - min, mean, corr: correlation(za, zb.map((v) => -v)), vals, za, zb };
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i]! - ma;
    const xb = b[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  if (den < 1e-18) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

function scanFlip(
  fieldA: ScalarField,
  fieldB: ScalarField,
  pts: { x: number; y: number }[],
  flip: FlipKind,
): ScanSample[] {
  const scan: ScanSample[] = [];
  for (let i = 0; i < COARSE; i++) {
    const offsetHours = (i / COARSE) * 12;
    const s = scoreAt(fieldA, fieldB, pts, flip, offsetHours);
    scan.push({ offsetHours, rms: s.rms, pv: s.pv });
  }
  return scan;
}

function bestOfScan(scan: ScanSample[]): ScanSample {
  let best = scan[0]!;
  for (const s of scan) {
    if (s.rms < best.rms) best = s;
  }
  return best;
}

function refineOffset(
  fieldA: ScalarField,
  fieldB: ScalarField,
  pts: { x: number; y: number }[],
  flip: FlipKind,
  seed: number,
): number {
  let bestOff = seed;
  let bestRms = scoreAt(fieldA, fieldB, pts, flip, seed).rms;
  const steps = Math.round((FINE_SPAN * 2) / FINE_STEP);
  for (let i = 0; i <= steps; i++) {
    const off = wrapHours(seed - FINE_SPAN + i * FINE_STEP);
    const rms = scoreAt(fieldA, fieldB, pts, flip, off).rms;
    if (rms < bestRms) {
      bestRms = rms;
      bestOff = off;
    }
  }
  return bestOff;
}

export type ParallelismOpts = {
  flip: FlipKind | "auto";
  offsetHours: number | "auto";
};

export function analyzeParallelism(
  pointsA: Reading[],
  pointsB: Reading[],
  jobA: Job,
  jobB: Job,
  opts: ParallelismOpts,
): ParallelismResult {
  try {
    return analyzeUnsafe(pointsA, pointsB, jobA, jobB, opts);
  } catch {
    return emptyResult(pointsA.length, pointsB.length);
  }
}

function analyzeUnsafe(
  pointsA: Reading[],
  pointsB: Reading[],
  jobA: Job,
  jobB: Job,
  opts: ParallelismOpts,
): ParallelismResult {
  const nA = pointsA.length;
  const nB = pointsB.length;
  const fa = residualField(pointsA, jobA);
  const fb = residualField(pointsB, jobB);
  if (!fa || !fb) return emptyResult(nA, nB);

  const pts = discSamples(GRID);
  const flips: FlipKind[] =
    opts.flip === "auto" ? ["none", "mirror12", "mirror39"] : [opts.flip];

  type Cand = { flip: FlipKind; scan: ScanSample[]; seed: ScanSample };
  const cands: Cand[] = flips.map((flip) => {
    const scan = scanFlip(fa.field, fb.field, pts, flip);
    return { flip, scan, seed: bestOfScan(scan) };
  });
  cands.sort((a, b) => a.seed.rms - b.seed.rms);
  const winner = cands[0]!;
  const flip = winner.flip;

  let offsetHours: number;
  if (opts.offsetHours === "auto") {
    offsetHours = refineOffset(fa.field, fb.field, pts, flip, winner.seed.offsetHours);
  } else {
    offsetHours = wrapHours(opts.offsetHours);
    if (opts.flip === "auto") {
      let best = cands[0]!;
      let bestRms = scoreAt(fa.field, fb.field, pts, best.flip, offsetHours).rms;
      for (const c of cands) {
        const rms = scoreAt(fa.field, fb.field, pts, c.flip, offsetHours).rms;
        if (rms < bestRms) {
          bestRms = rms;
          best = c;
        }
      }
      return finalize(fa, fb, pts, best.flip, offsetHours, best.scan, nA, nB, jobA.odMm);
    }
  }

  return finalize(fa, fb, pts, flip, offsetHours, winner.scan, nA, nB, jobA.odMm);
}

function finalize(
  fa: XYField,
  fb: XYField,
  pts: { x: number; y: number }[],
  flip: FlipKind,
  offsetHours: number,
  scan: ScanSample[],
  nA: number,
  nB: number,
  odMm: number,
): ParallelismResult {
  const scored = scoreAt(fa.field, fb.field, pts, flip, offsetHours);
  const mean = scored.mean;
  const formA: ScalarField = fa.field;
  const formB: ScalarField = (x, y) => {
    const m = mapToB(x, y, flip, offsetHours);
    return fb.field(m.x, m.y);
  };
  const field: ScalarField = (x, y) => {
    if (x * x + y * y > 1.002) return Number.NaN;
    const a = formA(x, y);
    const b = formB(x, y);
    return a + b - mean;
  };

  const thickPts: { x: number; y: number; z: number }[] = [];
  for (const p of pts) {
    const a = fa.field(p.x, p.y);
    const m = mapToB(p.x, p.y, flip, offsetHours);
    const b = fb.field(m.x, m.y);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    thickPts.push({ x: p.x, y: p.y, z: a + b - mean });
  }
  const plane = fitPlane(thickPts);
  let wedgeMm = 0;
  let wedgeDeg = 0;
  let wedgeClockHours = 0;
  if (plane) {
    const grad = Math.hypot(plane.b, plane.c);
    wedgeMm = 2 * grad;
    const radiusMm = odMm / 2 || 1;
    wedgeDeg = (Math.atan(grad / radiusMm) * 180) / Math.PI;
    let h = (Math.atan2(plane.b, plane.c) / (Math.PI * 2)) * 12;
    if (h < 0) h += 12;
    wedgeClockHours = h;
  }

  const probe: number[] = [];
  for (let j = 0; j < 24; j++) {
    for (let i = 0; i < 24; i++) {
      const x = (i / 23) * 2 - 1;
      const y = 1 - (j / 23) * 2;
      if (x * x + y * y > 0.98) continue;
      const v = field(x, y);
      if (Number.isFinite(v)) probe.push(v);
    }
  }
  const high = probe.length ? Math.max(...probe) : 0;
  const low = probe.length ? Math.min(...probe) : 0;
  const p2 = percentile(probe, 2);
  const p98 = percentile(probe, 98);
  const colorScale = Math.max(0.02, Math.max(Math.abs(p2), Math.abs(p98), 0.02));

  const bestRms = scored.rms;
  let altOffsetHours: number | null = null;
  const alt = wrapHours(offsetHours + 6);
  const altScore = scoreAt(fa.field, fb.field, pts, flip, alt);
  if (Number.isFinite(altScore.rms) && altScore.rms < bestRms * 1.25 && altScore.rms < bestRms + 0.04) {
    altOffsetHours = alt;
  }

  return {
    ready: true,
    nA,
    nB,
    flip,
    offsetHours,
    rms: scored.rms,
    thicknessPv: high - low,
    thicknessHigh: high,
    thicknessLow: low,
    wedgeMm,
    wedgeDeg,
    wedgeClockHours,
    corr: scored.corr,
    flatnessA: fa.flatness,
    flatnessB: fb.flatness,
    scan,
    field,
    colorScale,
    formA,
    formB,
    formScale: Math.max(0.05, fa.flatness, fb.flatness) * 0.45,
    clockBAt12: clockOnB(0, flip, offsetHours),
    altOffsetHours,
  };
}
