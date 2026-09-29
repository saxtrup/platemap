/** Diverging blue ↔ paper ↔ rust. t is in [-1, 1], 0 is dial-zero. */
const STOPS: { t: number; c: [number, number, number] }[] = [
  { t: -1, c: [24, 64, 122] },
  { t: -0.65, c: [52, 108, 168] },
  { t: -0.28, c: [132, 172, 198] },
  { t: 0, c: [232, 222, 210] },
  { t: 0.28, c: [214, 168, 138] },
  { t: 0.65, c: [190, 96, 70] },
  { t: 1, c: [168, 48, 36] },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function divergingRgb(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1]!.t < x) i += 1;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const u = (x - a.t) / (b.t - a.t || 1);
  return [
    Math.round(lerp(a.c[0], b.c[0], u)),
    Math.round(lerp(a.c[1], b.c[1], u)),
    Math.round(lerp(a.c[2], b.c[2], u)),
  ];
}

export function divergingCss(t: number): string {
  const [r, g, b] = divergingRgb(t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function colorBarCss(): string {
  const n = 12;
  const parts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    parts.push(`${divergingCss(t)} ${(i / n) * 100}%`);
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

export function zToT(z: number, scale: number): number {
  if (scale < 1e-12) return 0;
  return Math.max(-1, Math.min(1, z / scale));
}
