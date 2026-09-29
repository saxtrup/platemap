import type { Job, JobSnapshot, Reading } from "./types";
import { formatClock, parseClock } from "./geometry";
import { uid } from "./utils";

export function serializeCsv(snap: JobSnapshot): string {
  const { job, points } = snap;
  const lines = [
    `# ${job.name}`,
    `# od_mm=${job.odMm}`,
    `# id_mm=${job.idMm}`,
    `# dial_unit_mm=${job.dialUnitMm}`,
    `# clock_deg: 0 at 12 o'clock, clockwise`,
    `# r_frac: 0 centre, 1 outer diameter`,
    `# dial: indicator reading in dial divisions (mm = dial * dial_unit_mm)`,
    `clock,r_frac,dial`,
  ];
  for (const p of points) {
    lines.push(`${formatClock(p.clockHours)},${p.rFrac.toFixed(4)},${p.dial}`);
  }
  return lines.join("\n") + "\n";
}

export function serializeJson(snap: JobSnapshot): string {
  return JSON.stringify(
    {
      name: snap.job.name,
      odMm: snap.job.odMm,
      idMm: snap.job.idMm,
      dialUnitMm: snap.job.dialUnitMm,
      points: snap.points.map((p) => ({
        clock: formatClock(p.clockHours),
        rFrac: p.rFrac,
        dial: p.dial,
      })),
    },
    null,
    2,
  );
}

export function parseJobText(text: string): JobSnapshot | null {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJson(trimmed);
  }
  return parseCsv(trimmed);
}

function parseJson(text: string): JobSnapshot | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const job = jobFromUnknown(raw);
    const arr = (raw.points as unknown[]) ?? [];
    const points: Reading[] = [];
    for (const item of arr) {
      const p = pointFromUnknown(item);
      if (p) points.push(p);
    }
    return { job, points, photo: { src: null, scale: 1, panX: 0, panY: 0, rotationDeg: 0 } };
  } catch {
    return null;
  }
}

function jobFromUnknown(raw: Record<string, unknown>): Job {
  return {
    name: String(raw.name ?? raw.job ?? "Imported face"),
    odMm: num(raw.odMm ?? raw.od_mm, 435),
    idMm: num(raw.idMm ?? raw.id_mm, 0),
    dialUnitMm: num(raw.dialUnitMm ?? raw.dial_unit_mm, 0.01),
  };
}

function pointFromUnknown(item: unknown): Reading | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const clock =
    parseClock(String(o.clock ?? o.CLK ?? o.clk ?? "")) ??
    num(o.clockHours, Number.NaN);
  const rFrac = num(o.rFrac ?? o.r_frac, Number.NaN);
  const rPct = num(o.R ?? o.r, Number.NaN);
  const r = Number.isFinite(rFrac) ? rFrac : Number.isFinite(rPct) ? (rPct > 1.5 ? rPct / 100 : rPct) : Number.NaN;
  const dial = num(o.dial ?? o.DIAL, Number.NaN);
  if (!Number.isFinite(clock) || !Number.isFinite(r) || !Number.isFinite(dial)) return null;
  return { id: uid(), clockHours: clock, rFrac: clamp01(r), dial };
}

function parseCsv(text: string): JobSnapshot | null {
  const lines = text.split(/\r?\n/);
  const job: Job = { name: "Imported face", odMm: 435, idMm: 0, dialUnitMm: 0.01 };
  let header: string[] | null = null;
  const points: Reading[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      const body = t.slice(1).trim();
      const kv = /^(od_mm|id_mm|dial_unit_mm|name)\s*=\s*(.+)$/i.exec(body);
      if (kv) {
        const k = kv[1]!.toLowerCase();
        const v = kv[2]!;
        if (k === "od_mm") job.odMm = num(v, job.odMm);
        else if (k === "id_mm") job.idMm = num(v, job.idMm);
        else if (k === "dial_unit_mm") job.dialUnitMm = num(v, job.dialUnitMm);
        else job.name = v;
      } else if (!body.includes("=") && !body.includes(":")) {
        job.name = body;
      }
      continue;
    }
    const cols = t.split(/[,;\t]/).map((c) => c.trim());
    if (!header) {
      header = cols.map((c) => c.toLowerCase().replace(/^\uFEFF/, ""));
      const looksHeader = header.some((c) =>
        ["clock", "clk", "r", "r_frac", "dial", "mm"].includes(c),
      );
      if (!looksHeader) {
        header = ["clock", "r_frac", "dial"];
        const p = readingFromCols(header, cols);
        if (p) points.push(p);
      }
      continue;
    }
    const p = readingFromCols(header, cols);
    if (p) points.push(p);
  }
  if (points.length === 0) return null;
  return { job, points, photo: { src: null, scale: 1, panX: 0, panY: 0, rotationDeg: 0 } };
}

function readingFromCols(header: string[], cols: string[]): Reading | null {
  const get = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0 && cols[i] != null) return cols[i]!;
    }
    return "";
  };
  const clock = parseClock(get("clock", "clk")) ?? num(get("clockhours"), Number.NaN);
  let r = num(get("r_frac", "rfrac"), Number.NaN);
  if (!Number.isFinite(r)) {
    const rp = get("r");
    const n = num(rp.replace("%", ""), Number.NaN);
    r = n > 1.5 ? n / 100 : n;
  }
  let dial = num(get("dial"), Number.NaN);
  if (!Number.isFinite(dial) && Number.isFinite(num(get("mm"), Number.NaN))) {
    // leave dial NaN — caller needs unit; treat mm as dial if unit 0.01 later
    dial = num(get("mm"), Number.NaN);
  }
  if (!Number.isFinite(clock) || !Number.isFinite(r) || !Number.isFinite(dial)) return null;
  return { id: uid(), clockHours: clock, rFrac: clamp01(r), dial };
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1.02, v));
}
