import type { Analysis } from "./analysis";
import { divergingRgb, zToT } from "./colormap";
import { contourLevels, marchingSquares } from "./contours";
import { formatClock, formatMm, polarToXY } from "./geometry";
import { sampleGrid, type HeightGrid } from "./interpolate";
import type { Draft, PhotoFit, Reading } from "./types";

export type MapDrawOpts = {
  width: number;
  height: number;
  dpr: number;
  analysis: Analysis;
  points: Reading[];
  photo: PhotoFit;
  photoImage: CanvasImageSource | null;
  photoReady: boolean;
  subtractPlane: boolean;
  showContours: boolean;
  showPoints: boolean;
  showHeatmap: boolean;
  contourStep: number;
  wash: number;
  selectedId: string | null;
  draft: Draft | null;
  cutClockHours: number | null;
  showCut: boolean;
  jobName: string;
  odMm: number;
  idFrac: number;
  dialUnitMm: number;
};

let cachedGridKey = "";
let cachedGrid: HeightGrid | null = null;
let cachedContourKey = "";
let cachedContours: ReturnType<typeof marchingSquares> = [];

type Offscreen = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; size: number };
let offRec: Offscreen | null = null;

export function getCachedGrid(analysis: Analysis, size = 160): HeightGrid {
  const key = `${analysis.n}:${analysis.colorScale.toFixed(5)}:${size}:${analysis.samples.map((s) => s.z.toFixed(3)).join(",")}:${analysis.samples.map((s) => s.res.toFixed(3)).join(",")}`;
  if (cachedGrid && cachedGridKey === key) return cachedGrid;
  cachedGrid = sampleGrid(analysis.field, size, 0);
  cachedGridKey = key;
  return cachedGrid;
}

function clockLabel(h: number): string {
  if (h === 0 || h === 12) return "12";
  return String(h);
}

export function faceLayout(width: number, height: number) {
  const pad = Math.min(44, Math.max(32, Math.round(Math.min(width, height) * 0.07)));
  const size = Math.max(40, Math.min(width, height) - pad * 2);
  const R = size / 2;
  const cx = width / 2;
  const cy = height >= width * 1.12 ? pad + R : height / 2;
  return { pad, cx, cy, R };
}

function clipFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
}

export function drawMap(ctx: CanvasRenderingContext2D, opts: MapDrawOpts) {
  const { width, height, dpr, idFrac } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { cx, cy, R } = faceLayout(width, height);

  ctx.save();
  clipFace(ctx, cx, cy, R);

  ctx.fillStyle = "#1a1c22";
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  drawPhoto(ctx, cx, cy, R, opts);
  if (opts.showHeatmap && opts.analysis.n >= 1) drawHeatmap(ctx, cx, cy, R, opts);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232,230,225,0.38)";
  ctx.lineWidth = 1.35;
  ctx.stroke();
  if (idFrac > 0.04) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * idFrac, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(232,230,225,0.22)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (opts.showContours && opts.analysis.n >= 3) {
    ctx.save();
    clipFace(ctx, cx, cy, R - 0.5);
    drawContours(ctx, cx, cy, R, opts);
    ctx.restore();
  }

  if (opts.showCut && opts.cutClockHours != null) {
    drawCutLine(ctx, cx, cy, R, opts.cutClockHours);
  }

  drawClockRing(ctx, cx, cy, R);

  if (opts.showPoints) drawPoints(ctx, cx, cy, R, opts);
  if (opts.draft) drawDraft(ctx, cx, cy, R, opts.draft);
}

function photoNaturalSize(img: CanvasImageSource): { w: number; h: number } {
  if (img instanceof HTMLImageElement) {
    return { w: img.naturalWidth, h: img.naturalHeight };
  }
  if (img instanceof HTMLCanvasElement) {
    return { w: img.width, h: img.height };
  }
  const anyImg = img as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return {
    w: Number(anyImg.naturalWidth ?? anyImg.width ?? 0),
    h: Number(anyImg.naturalHeight ?? anyImg.height ?? 0),
  };
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: MapDrawOpts,
) {
  const img = opts.photoImage;
  const src = opts.photo.src;
  if (!img || !src || !opts.photoReady) return;
  const { w: iw, h: ih } = photoNaturalSize(img);
  if (!(iw > 0 && ih > 0)) return;
  const { scale, panX, panY, rotationDeg } = opts.photo;
  ctx.save();
  ctx.translate(cx + panX * R, cy + panY * R);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  const side = R * 2 * scale;
  const cover = Math.max(side / iw, side / ih);
  const dw = iw * cover;
  const dh = ih * cover;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: MapDrawOpts,
) {
  const grid = getCachedGrid(opts.analysis, 180);
  const size = grid.size;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const wash = Math.max(0, Math.min(100, opts.wash)) / 100;
  const alpha = Math.round(255 * (1 - wash));
  const scale = opts.analysis.colorScale;
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
  const off = offscreen(size);
  off.ctx.clearRect(0, 0, size, size);
  off.ctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off.canvas, cx - R, cy - R, R * 2, R * 2);
}

function drawContours(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: MapDrawOpts,
) {
  const grid = getCachedGrid(opts.analysis, 180);
  const finite: number[] = [];
  for (let i = 0; i < grid.z.length; i++) {
    const v = grid.z[i]!;
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const levels = contourLevels(min, max, opts.contourStep);
  const key = `${cachedGridKey}:${opts.contourStep}:${levels.join(",")}`;
  let sets = cachedContours;
  if (cachedContourKey !== key) {
    sets = marchingSquares(grid, levels);
    cachedContours = sets;
    cachedContourKey = key;
  }

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
      for (let i = 1; i < line.length; i++) {
        ctx.lineTo(cx + line[i]!.x * R, cy - line[i]!.y * R);
      }
    }
    ctx.stroke();
  }

  ctx.font = `500 ${Math.max(9, Math.round(R * 0.032))}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const set of sets) {
    if (set.lines.length === 0) continue;
    const isZero = Math.abs(set.level) < opts.contourStep * 0.25;
    if (!isZero && Math.round(set.level / opts.contourStep) % 2 !== 0) continue;
    const label = formatContour(set.level, opts.dialUnitMm);
    let placed = 0;
    const minLen = Math.max(24, Math.round(grid.size * 0.12));
    for (const line of set.lines) {
      if (line.length < minLen) continue;
      const i = Math.floor(line.length * 0.45);
      const p = line[i]!;
      const rr = p.x * p.x + p.y * p.y;
      if (rr > 0.88 || rr < 0.06) continue;
      const x = cx + p.x * R;
      const y = cy - p.y * R;
      ctx.fillStyle = "rgba(12,13,16,0.55)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(x - tw / 2 - 3, y - 6, tw + 6, 12);
      ctx.fillStyle = "rgba(236,232,224,0.92)";
      ctx.fillText(label, x, y);
      placed += 1;
      if (placed >= 1) break;
    }
  }
}

function formatContour(level: number, dialUnit: number): string {
  if (Math.abs(level) < 1e-6) return "0";
  if (dialUnit > 0 && Math.abs(level / dialUnit - Math.round(level / dialUnit)) < 0.05) {
    return String(Math.round(level / dialUnit));
  }
  return formatMm(level, 2).replace("+", "");
}

function drawClockRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  ctx.font = `500 ${Math.max(10, Math.round(R * 0.048))}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(168,170,176,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let h = 1; h <= 12; h++) {
    const ang = (h / 12) * Math.PI * 2;
    const rr = R + Math.max(14, R * 0.065);
    ctx.fillText(clockLabel(h), cx + Math.sin(ang) * rr, cy - Math.cos(ang) * rr);
  }
  ctx.strokeStyle = "rgba(232,230,225,0.2)";
  ctx.lineWidth = 1;
  for (let h = 0; h < 12; h++) {
    const ang = (h / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(ang) * (R + 2), cy - Math.cos(ang) * (R + 2));
    ctx.lineTo(cx + Math.sin(ang) * (R + 7), cy - Math.cos(ang) * (R + 7));
    ctx.stroke();
  }
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  opts: MapDrawOpts,
) {
  for (const p of opts.points) {
    const { x, y } = polarToXY(p.clockHours, p.rFrac);
    const px = cx + x * R;
    const py = cy - y * R;
    const selected = p.id === opts.selectedId;
    const z = p.dial * opts.dialUnitMm;
    const shown = opts.subtractPlane
      ? (opts.analysis.samples.find((s) => s.id === p.id)?.res ?? z)
      : z;
    const [r, g, b] = divergingRgb(zToT(shown, opts.analysis.colorScale));
    ctx.beginPath();
    ctx.arc(px, py, selected ? 4.5 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    ctx.strokeStyle = selected ? "rgba(255,255,255,0.95)" : "rgba(12,13,16,0.75)";
    ctx.lineWidth = selected ? 1.6 : 0.9;
    ctx.stroke();
  }
}

function drawDraft(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  draft: Draft,
) {
  const { x, y } = polarToXY(draft.clockHours, draft.rFrac);
  const px = cx + x * R;
  const py = cy - y * R;
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232,230,225,0.9)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(px, py, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#e8e6e1";
  ctx.fill();
}

function drawCutLine(
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

function offscreen(size: number): Offscreen {
  if (offRec && offRec.size === size) return offRec;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2d");
  offRec = { canvas, ctx: c, size };
  return offRec;
}

export function canvasToPolar(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  idFrac = 0,
): { clockHours: number; rFrac: number; inside: boolean } {
  const { cx, cy, R } = faceLayout(width, height);
  const x = (offsetX - cx) / R;
  const y = (cy - offsetY) / R;
  const rFrac = Math.hypot(x, y);
  let clockHours = (Math.atan2(x, y) / (Math.PI * 2)) * 12;
  if (clockHours < 0) clockHours += 12;
  const inside = rFrac <= 1.04 && rFrac >= idFrac * 0.9;
  return { clockHours, rFrac, inside };
}

export function findHit(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  points: Reading[],
  threshPx = 18,
): string | null {
  const { cx, cy, R } = faceLayout(width, height);
  let best: string | null = null;
  let bestD = threshPx;
  for (const p of points) {
    const { x, y } = polarToXY(p.clockHours, p.rFrac);
    const px = cx + x * R;
    const py = cy - y * R;
    const d = Math.hypot(offsetX - px, offsetY - py);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}
