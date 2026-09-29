const TAU = Math.PI * 2;

export function clockToRad(clockHours: number): number {
  return (clockHours / 12) * TAU;
}

export function radToClock(rad: number): number {
  let h = (rad / TAU) * 12;
  h %= 12;
  if (h < 0) h += 12;
  return h;
}

/** x = 3 o'clock, y = 12 o'clock, both in radius-fraction units. */
export function polarToXY(clockHours: number, rFrac: number): { x: number; y: number } {
  const th = clockToRad(clockHours);
  return { x: rFrac * Math.sin(th), y: rFrac * Math.cos(th) };
}

export function xyToPolar(x: number, y: number): { clockHours: number; rFrac: number } {
  return { clockHours: radToClock(Math.atan2(x, y)), rFrac: Math.hypot(x, y) };
}

export function formatClock(clockHours: number): string {
  let hours = clockHours % 12;
  if (hours < 0) hours += 12;
  const totalMin = hours * 60;
  let hh = Math.floor((totalMin + 1e-6) / 60);
  let mm = Math.round(totalMin - hh * 60);
  if (mm === 60) {
    mm = 0;
    hh += 1;
  }
  hh %= 12;
  const display = hh === 0 ? 12 : hh;
  return `${display}:${mm.toString().padStart(2, "0")}`;
}

export function parseClock(raw: string): number | null {
  const s = raw.trim();
  const m = /^(\d{1,2})[:h.](\d{1,2})$/.exec(s);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
    const hours = (hh % 12) + mm / 60;
    return hours;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 12) return null;
  return n % 12;
}

export function formatMm(z: number, digits = 2): string {
  if (!Number.isFinite(z)) return "—";
  const abs = Math.abs(z);
  const body = abs.toFixed(digits);
  if (z > 0.5 * 10 ** -digits) return `+${body}`;
  if (z < -0.5 * 10 ** -digits) return `-${body}`;
  return Number(0).toFixed(digits);
}

export function formatRatio(slope: number): string {
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) return "—";
  const run = Math.round(1 / Math.abs(slope));
  return `1:${run}`;
}

export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = A[i];
    if (!row || row.length !== n) return null;
    M[i] = new Array(n + 1);
    for (let j = 0; j < n; j++) M[i][j] = row[j] ?? 0;
    M[i][n] = b[i] ?? 0;
  }
  for (let k = 0; k < n; k++) {
    let piv = k;
    let best = Math.abs(M[k][k] ?? 0);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k] ?? 0);
      if (v > best) {
        best = v;
        piv = i;
      }
    }
    if (best < 1e-12) return null;
    if (piv !== k) {
      const tmp = M[k];
      M[k] = M[piv]!;
      M[piv] = tmp!;
    }
    const diag = M[k][k]!;
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k]! / diag;
      for (let j = k; j <= n; j++) M[i][j]! -= f * M[k][j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]!;
    for (let j = i + 1; j < n; j++) s -= M[i][j]! * x[j]!;
    const d = M[i][i]!;
    if (Math.abs(d) < 1e-12) return null;
    x[i] = s / d;
  }
  return x;
}

/** Least-squares plane z = a + b x + c y. */
export function fitPlane(
  pts: { x: number; y: number; z: number }[],
): { a: number; b: number; c: number } | null {
  if (pts.length < 3) return null;
  let n = 0,
    sx = 0,
    sy = 0,
    sz = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sxz = 0,
    syz = 0;
  for (const p of pts) {
    n += 1;
    sx += p.x;
    sy += p.y;
    sz += p.z;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sxz += p.x * p.z;
    syz += p.y * p.z;
  }
  const sol = solveLinear(
    [
      [n, sx, sy],
      [sx, sxx, sxy],
      [sy, sxy, syy],
    ],
    [sz, sxz, syz],
  );
  if (!sol) return null;
  return { a: sol[0]!, b: sol[1]!, c: sol[2]! };
}

/** Quadratic bowl z = k r² + d on (already residual) samples. Sagitta = centre − rim = −k. */
export function fitBowl(pts: { x: number; y: number; z: number }[]): {
  k: number;
  d: number;
  sagitta: number;
} | null {
  if (pts.length < 4) return null;
  let n = 0,
    sr = 0,
    sz = 0,
    srr = 0,
    srz = 0;
  for (const p of pts) {
    const r2 = p.x * p.x + p.y * p.y;
    n += 1;
    sr += r2;
    sz += p.z;
    srr += r2 * r2;
    srz += r2 * p.z;
  }
  const det = n * srr - sr * sr;
  if (Math.abs(det) < 1e-12) return null;
  const k = (n * srz - sr * sz) / det;
  const d = (sz - k * sr) / n;
  return { k, d, sagitta: -k };
}
