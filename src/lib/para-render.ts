import { divergingRgb, zToT } from "./colormap";
import { contourLevels, marchingSquares } from "./contours";
import { formatClock, formatMm, polarToXY } from "./geometry";
import { sampleGrid } from "./interpolate";
import { faceLayout } from "./map-render";
import { mapFromB, type ParallelismResult } from "./parallelism";
import type { FlipKind, Reading } from "./types";

export type ParaDrawOpts = {
  width: number;
  height: number;
  dpr: number;
  result: ParallelismResult;
  pointsA: Reading[];
  pointsB: Reading[];
  flip: FlipKind;
  offsetHours: number;
  showPoints: boolean;
  showContours: boolean;
  contourStep: number;
  wash: number;
  cutClockHours: number | null;
  thicknessMm: number;
  dialUnitMm: number;
};

let cachedKey = "";
let cachedGrid: ReturnType<typeof sampleGrid> | null = null;

function gridFor(result: ParallelismResult) {
  const key = `${result.nA}:${result.nB}:${result.flip}:${result.offsetHours.toFixed(3)}:${result.rms.toFixed(5)}`;
  if (cachedGrid && cachedKey === key) return cachedGrid;
  cachedGrid = sampleGrid(result.field, 160);
  cachedKey = key;
  return cachedGrid;
}

function clipFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
}

export function drawParaMap(ctx: CanvasRenderingContext2D, opts: ParaDrawOpts) {
  const { width, height, dpr, result } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { cx, cy, R } = faceLayout(width, height);

  ctx.save();
  clipFace(ctx, cx, cy, R);
  ctx.fillStyle = "#1a1c22";
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  if (result.ready) drawHeatmap(ctx, cx, cy, R, opts);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232,230,225,0.38)";
  ctx.lineWidth = 1.35;
  ctx.stroke();

  if (opts.showContours && result.ready) {
    ctx.save();
    clipFace(ctx, cx, cy, R - 0.5);
    drawContours(ctx, cx, cy, R, opts);
    ctx.restore();
  }

  if (opts.cutClockHours != null) drawCut(ctx, cx, cy, R, opts.cutClockHours);
  drawClockRing(ctx, cx, cy, R);
  if (opts.showPoints && result.ready) drawPoints(ctx, cx, cy, R, opts);
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: ParaDrawOpts,
) {
  const grid = gridFor(opts.result);
  const size = grid.size;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const wash = Math.max(0, Math.min(100, opts.wash)) / 100;
  const alpha = Math.round(255 * (1 - wash));
  const scale = opts.result.colorScale;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const z = grid.z[j * size + i]!;
      const idx = (j * size + i) * 4;
      if (!Number.isFinite(z)) {
        data[idx + 3] = 0;
        continue;
      }
      const [r, g, b] = divergingRgb(zToT(z, scale));
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
    }
  }
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const octx = off.getContext("2d");
  if (!octx) return;
  octx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, cx - R, cy - R, R * 2, R * 2);
}

function drawContours(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: ParaDrawOpts,
) {
  const grid = gridFor(opts.result);
  const finite: number[] = [];
  for (let i = 0; i < grid.z.length; i++) {
    const v = grid.z[i]!;
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return;
  const levels = contourLevels(Math.min(...finite), Math.max(...finite), opts.contourStep);
  const sets = marchingSquares(grid, levels);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const set of sets) {
    const isZero = Math.abs(set.level) < opts.contourStep * 0.25;
    ctx.strokeStyle = isZero ? "rgba(20,20,22,0.78)" : "rgba(20,18,16,0.42)";
    ctx.lineWidth = isZero ? 1.4 : 0.85;
    ctx.beginPath();
    for (const line of set.lines) {
      if (line.length < 2) continue;
      ctx.moveTo(cx + line[0]!.x * R, cy - line[0]!.y * R);
      for (let k = 1; k < line.length; k++) {
        ctx.lineTo(cx + line[k]!.x * R, cy - line[k]!.y * R);
      }
    }
    ctx.stroke();
  }
}

function drawClockRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  ctx.font = `500 ${Math.max(10, Math.round(R * 0.048))}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(168,170,176,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let h = 1; h <= 12; h++) {
    const ang = (h / 12) * Math.PI * 2;
    const rr = R + Math.max(14, R * 0.065);
    const label = h === 12 ? "12" : String(h);
    ctx.fillText(label, cx + Math.sin(ang) * rr, cy - Math.cos(ang) * rr);
  }
}

function drawCut(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  clockHours: number,
) {
  const { x, y } = polarToXY(clockHours, 1);
  ctx.beginPath();
  ctx.moveTo(cx - x * R, cy + y * R);
  ctx.lineTo(cx + x * R, cy - y * R);
  ctx.strokeStyle = "rgba(232,230,225,0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `500 11px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(232,230,225,0.75)";
  ctx.textAlign = "center";
  ctx.fillText(formatClock(clockHours), cx + x * (R + 22), cy - y * (R + 22));
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: ParaDrawOpts,
) {
  const scale = opts.result.colorScale;
  for (const p of opts.pointsA) {
    const { x, y } = polarToXY(p.clockHours, p.rFrac);
    const px = cx + x * R;
    const py = cy - y * R;
    const z = opts.result.field(x, y);
    const [r, g, b] = divergingRgb(zToT(Number.isFinite(z) ? z : 0, scale));
    ctx.beginPath();
    ctx.arc(px, py, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    ctx.strokeStyle = "rgba(232,230,225,0.85)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  for (const p of opts.pointsB) {
    const { x, y } = polarToXY(p.clockHours, p.rFrac);
    const mapped = mapFromB(x, y, opts.flip, opts.offsetHours);
    const px = cx + mapped.x * R;
    const py = cy - mapped.y * R;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.rect(-2.6, -2.6, 5.2, 5.2);
    ctx.fillStyle = "rgba(12,13,16,0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(122,160,208,0.95)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

export function drawScanChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  scan: ParallelismResult["scan"],
  offsetHours: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (scan.length < 2) return;

  const padL = 2;
  const padR = 2;
  const padT = 6;
  const padB = 6;
  const finite = scan.filter((s) => Number.isFinite(s.rms));
  if (finite.length < 2) return;
  const min = Math.min(...finite.map((s) => s.rms));
  const max = Math.max(...finite.map((s) => s.rms));
  const span = Math.max(1e-6, max - min);

  const X = (h: number) => padL + (wrap01(h / 12) * (width - padL - padR));
  const Y = (rms: number) => padT + (1 - (rms - min) / span) * (height - padT - padB);

  ctx.beginPath();
  finite.forEach((s, i) => {
    const x = X(s.offsetHours);
    const y = Y(s.rms);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "rgba(232,230,225,0.75)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const xOff = X(offsetHours);
  ctx.beginPath();
  ctx.moveTo(xOff, padT);
  ctx.lineTo(xOff, height - padB);
  ctx.strokeStyle = "rgba(212,138,116,0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "rgba(92,94,102,0.95)";
  ctx.font = '400 9px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("0h", padL, height - 10);
  ctx.textAlign = "center";
  ctx.fillText("6h", width / 2, height - 10);
  ctx.textAlign = "right";
  ctx.fillText("12h", width - padR, height - 10);
}

function wrap01(t: number): number {
  let x = t % 1;
  if (x < 0) x += 1;
  return x;
}

export function drawThicknessCut(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  result: ParallelismResult,
  cutClockHours: number,
  thicknessMm: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0c0d10";
  ctx.fillRect(0, 0, width, height);
  if (!result.ready) return;

  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const N = 160;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * 2 - 1;
    const { x, y } = polarToXY(cutClockHours, s);
    xs.push(s);
    zs.push(result.field(x, y));
  }
  const finite = zs.filter(Number.isFinite);
  let zmin = finite.length ? Math.min(...finite) : -0.2;
  let zmax = finite.length ? Math.max(...finite) : 0.2;
  if (zmax === zmin) {
    zmax += 0.1;
    zmin -= 0.1;
  }
  const margin = (zmax - zmin) * 0.18;
  zmin -= margin;
  zmax += margin;

  const X = (s: number) => padL + ((s + 1) / 2) * plotW;
  const Y = (z: number) => padT + ((zmax - z) / (zmax - zmin)) * plotH;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = "rgba(139,141,147,0.9)";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const span = zmax - zmin;
  const step = niceStep(span / 4);
  const z0 = Math.ceil(zmin / step) * step;
  for (let z = z0; z <= zmax + 1e-9; z += step) {
    const yy = Y(z);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + plotW, yy);
    ctx.stroke();
    ctx.fillText(formatMm(z, 2), padL - 6, yy);
  }

  ctx.beginPath();
  ctx.moveTo(X(-1), Y(0));
  ctx.lineTo(X(1), Y(0));
  ctx.strokeStyle = "rgba(232,230,225,0.18)";
  ctx.stroke();

  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= N; i++) {
    const z = zs[i]!;
    if (!Number.isFinite(z)) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(X(xs[i]!), Y(z));
      started = true;
    } else {
      ctx.lineTo(X(xs[i]!), Y(z));
    }
  }
  ctx.strokeStyle = "rgba(232,230,225,0.9)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.fillStyle = "rgba(139,141,147,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = '400 10px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText(`Thickness deviation along ${formatClock(cutClockHours)}  ·  nominal ${thicknessMm} mm`, padL + plotW / 2, height - 18);
}

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0.1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nf = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nf * 10 ** exp;
}
