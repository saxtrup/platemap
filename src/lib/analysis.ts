import type { Job, Reading } from "./types";
import { fitBowl, fitPlane, polarToXY } from "./geometry";
import { makeTps, percentile, type ScalarField } from "./interpolate";

export type Sample = { x: number; y: number; z: number; res: number; id: string };

export type Analysis = {
  n: number;
  samples: Sample[];
  plane: { a: number; b: number; c: number } | null;
  high: number;
  low: number;
  peakValley: number;
  flatness: number;
  tiltDeg: number;
  tiltClockHours: number;
  bowlMm: number;
  bowlKind: "crowned" | "dished" | "flat";
  field: ScalarField;
  colorScale: number;
};

const EMPTY_FIELD: ScalarField = () => 0;

function emptyAnalysis(n: number): Analysis {
  return {
    n,
    samples: [],
    plane: null,
    high: 0,
    low: 0,
    peakValley: 0,
    flatness: 0,
    tiltDeg: 0,
    tiltClockHours: 0,
    bowlMm: 0,
    bowlKind: "flat",
    field: EMPTY_FIELD,
    colorScale: 0.02,
  };
}

export function analyze(
  points: Reading[],
  job: Job,
  subtractPlane: boolean,
): Analysis {
  try {
    return analyzeUnsafe(points, job, subtractPlane);
  } catch {
    return emptyAnalysis(points.length);
  }
}

function analyzeUnsafe(
  points: Reading[],
  job: Job,
  subtractPlane: boolean,
): Analysis {
  const samples: Sample[] = points.map((p) => {
    const { x, y } = polarToXY(p.clockHours, p.rFrac);
    const z = p.dial * job.dialUnitMm;
    return { x, y, z, res: z, id: p.id };
  });

  const plane = fitPlane(samples);
  if (plane) {
    for (const s of samples) s.res = s.z - (plane.a + plane.b * s.x + plane.c * s.y);
  }

  const zs = samples.map((s) => s.z);
  const high = zs.length ? Math.max(...zs) : 0;
  const low = zs.length ? Math.min(...zs) : 0;
  const peakValley = zs.length ? high - low : 0;
  const res = samples.map((s) => s.res);
  const flatness = res.length ? Math.max(...res) - Math.min(...res) : 0;

  let tiltDeg = 0;
  let tiltClockHours = 0;
  if (plane) {
    const grad = Math.hypot(plane.b, plane.c);
    const radiusMm = job.odMm / 2 || 1;
    const slope = grad / radiusMm;
    tiltDeg = (Math.atan(slope) * 180) / Math.PI;
    let h = (Math.atan2(plane.b, plane.c) / (Math.PI * 2)) * 12;
    if (h < 0) h += 12;
    tiltClockHours = h;
  }

  const bowlFit = fitBowl(
    samples.map((s) => ({ x: s.x, y: s.y, z: s.res })),
  );
  const bowlMm = bowlFit?.sagitta ?? 0;
  const bowlKind: Analysis["bowlKind"] =
    bowlMm > 0.015 ? "crowned" : bowlMm < -0.015 ? "dished" : "flat";

  const interpPts = samples.map((s) => ({
    x: s.x,
    y: s.y,
    z: subtractPlane ? s.res : s.z,
  }));
  let field: ScalarField = EMPTY_FIELD;
  try {
    field = samples.length ? makeTps(interpPts) : EMPTY_FIELD;
  } catch {
    field = EMPTY_FIELD;
  }

  const probe: number[] = [];
  if (samples.length) {
    for (let j = 0; j < 24; j++) {
      for (let i = 0; i < 24; i++) {
        const x = (i / 23) * 2 - 1;
        const y = 1 - (j / 23) * 2;
        if (x * x + y * y > 0.98) continue;
        const v = field(x, y);
        if (Number.isFinite(v)) probe.push(v);
      }
    }
  }
  const p2 = percentile(probe, 2);
  const p98 = percentile(probe, 98);
  const colorScale = Math.max(0.02, Math.max(Math.abs(p2), Math.abs(p98), 0.02));

  return {
    n: samples.length,
    samples,
    plane,
    high,
    low,
    peakValley,
    flatness,
    tiltDeg,
    tiltClockHours,
    bowlMm,
    bowlKind,
    field,
    colorScale,
  };
}
