import { useEffect, useRef } from "react";
import type { Analysis } from "@/lib/analysis";
import { divergingRgb, zToT } from "@/lib/colormap";
import { useJobStore } from "@/lib/store";
import { idFracOf } from "@/lib/types";

type Vert = { x: number; y: number; depth: number };
type Tri = {
  a: number;
  b: number;
  c: number;
  shade: number;
  color: [number, number, number];
};

/** Elevation from the plate plane. Negative looks up from underneath. */
const PITCH_MIN = -1.42;
const PITCH_MAX = 1.42;

function clampPitch(p: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));
}

export function View3D({ analysis }: { analysis: Analysis }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(0.55);
  const pitch = useRef(0.98);
  const dist = useRef(2.55);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const job = useJobStore((s) => s.job);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const cnv = canvas;
    const rect0 = wrap.getBoundingClientRect();
    let w = Math.max(32, Math.floor(rect0.width));
    let h = Math.max(32, Math.floor(rect0.height));
    let raf = 0;
    let running = true;

    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      w = Math.max(32, Math.floor(r.width));
      h = Math.max(32, Math.floor(r.height));
    });
    ro.observe(wrap);

    const idFrac = idFracOf(job);
    const nr = 22;
    const nt = 72;
    const scale = Math.max(0.02, analysis.colorScale);
    const exag = 0.14;

    const positions: { px: number; py: number; h: number; col: [number, number, number] }[] = [];
    const idxAt = (i: number, j: number) => i * nt + (j % nt);

    for (let i = 0; i <= nr; i++) {
      const t = i / nr;
      const rf = idFrac + (0.995 - idFrac) * t;
      for (let j = 0; j < nt; j++) {
        const th = (j / nt) * Math.PI * 2;
        const px = rf * Math.sin(th);
        const py = rf * Math.cos(th);
        const raw = analysis.field(px, py);
        const hv = Number.isFinite(raw) ? Math.max(-1.6 * scale, Math.min(1.6 * scale, raw)) : 0;
        positions.push({
          px,
          py,
          h: (hv / scale) * exag,
          col: divergingRgb(zToT(hv, scale)),
        });
      }
    }

    const tris: Tri[] = [];
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nt; j++) {
        const i00 = idxAt(i, j);
        const i10 = idxAt(i + 1, j);
        const i11 = idxAt(i + 1, j + 1);
        const i01 = idxAt(i, j + 1);
        const p00 = positions[i00]!;
        const p10 = positions[i10]!;
        const p11 = positions[i11]!;
        const p01 = positions[i01]!;
        const shadeOf = (
          a: (typeof positions)[0],
          b: (typeof positions)[0],
          c: (typeof positions)[0],
        ) => {
          const ux = b.px - a.px;
          const uy = b.h - a.h;
          const uz = b.py - a.py;
          const vx = c.px - a.px;
          const vy = c.h - a.h;
          const vz = c.py - a.py;
          const nx = uy * vz - uz * vy;
          const ny = uz * vx - ux * vz;
          const nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          const lit = (nx * 0.28 + ny * 0.9 + nz * 0.32) / nl;
          return 0.48 + 0.52 * Math.max(0, Math.min(1, lit));
        };
        tris.push({ a: i00, b: i10, c: i11, shade: shadeOf(p00, p10, p11), color: p10.col });
        tris.push({ a: i00, b: i11, c: i01, shade: shadeOf(p00, p11, p01), color: p00.col });
      }
    }

    const rim: number[] = [];
    for (let j = 0; j < nt; j++) rim.push(idxAt(nr, j));

    function project(px: number, py: number, height: number, W: number, H: number): Vert {
      const p = clampPitch(pitch.current);
      const yw = yaw.current;
      const d = dist.current;
      const cp = Math.cos(p);
      const sp = Math.sin(p);
      const cy = Math.cos(yw);
      const sinYaw = Math.sin(yw);

      const eyeX = d * cp * sinYaw;
      const eyeY = d * sp;
      const eyeZ = d * cp * cy;

      let fx = -eyeX;
      let fy = -eyeY;
      let fz = -eyeZ;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;

      const upHintY = Math.abs(fy) > 0.92 ? 0 : 1;
      const upHintZ = Math.abs(fy) > 0.92 ? 1 : 0;
      let rx = fy * upHintZ - fz * upHintY;
      let ry = fz * 0 - fx * upHintZ;
      let rz = fx * upHintY - fy * 0;
      const sl = Math.hypot(rx, ry, rz) || 1;
      rx /= sl;
      ry /= sl;
      rz /= sl;

      const ux = ry * fz - rz * fy;
      const uy = rz * fx - rx * fz;
      const uz = rx * fy - ry * fx;

      const dx = px - eyeX;
      const dy = height - eyeY;
      const dz = py - eyeZ;
      const right = dx * rx + dy * ry + dz * rz;
      const upv = dx * ux + dy * uy + dz * uz;
      const fwd = dx * fx + dy * fy + dz * fz;
      const persp = d / Math.max(0.45, fwd);
      const s = Math.min(W, H) * 0.44;
      return {
        x: W / 2 + right * persp * s,
        y: H * 0.5 - upv * persp * s,
        depth: fwd,
      };
    }

    function frame() {
      if (!running) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const bw = Math.floor(w * dpr);
      const bh = Math.floor(h * dpr);
      if (cnv.width !== bw || cnv.height !== bh) {
        cnv.width = bw;
        cnv.height = bh;
        cnv.style.width = `${w}px`;
        cnv.style.height = `${h}px`;
      }
      const ctx = cnv.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(frame);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0c0d10";
      ctx.fillRect(0, 0, w, h);

      const projected = positions.map((p) => project(p.px, p.py, p.h, w, h));

      if (pitch.current > 0.04) {
        const ground: Vert[] = [];
        for (let j = 0; j < nt; j++) {
          const th = (j / nt) * Math.PI * 2;
          ground.push(project(Math.sin(th), Math.cos(th), -0.02, w, h));
        }
        ctx.beginPath();
        ground.forEach((g, i) => {
          if (i === 0) ctx.moveTo(g.x, g.y);
          else ctx.lineTo(g.x, g.y);
        });
        ctx.closePath();
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fill();
      }

      const sorted = tris
        .map((t) => {
          const da = projected[t.a]!.depth;
          const db = projected[t.b]!.depth;
          const dc = projected[t.c]!.depth;
          return { t, d: (da + db + dc) / 3 };
        })
        .sort((p, q) => q.d - p.d);

      for (const s of sorted) {
        const A = projected[s.t.a]!;
        const B = projected[s.t.b]!;
        const C = projected[s.t.c]!;
        if (![A.x, A.y, B.x, B.y, C.x, C.y].every(Number.isFinite)) continue;
        if (A.depth < 0.2 || B.depth < 0.2 || C.depth < 0.2) continue;
        const [r, g, b] = s.t.color;
        const k = s.t.shade;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.lineTo(C.x, C.y);
        ctx.closePath();
        ctx.fillStyle = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
        ctx.fill();
      }

      ctx.beginPath();
      rim.forEach((idx, i) => {
        const p = projected[idx]!;
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(232,230,225,0.45)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = "rgba(139,141,147,0.9)";
      ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText("Drag to orbit · scroll to zoom", 16, h - 18);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function down(e: PointerEvent) {
      drag.current = { x: e.clientX, y: e.clientY };
      cnv.setPointerCapture(e.pointerId);
    }
    function move(e: PointerEvent) {
      if (!drag.current) return;
      yaw.current += (e.clientX - drag.current.x) * 0.008;
      pitch.current = clampPitch(pitch.current + (e.clientY - drag.current.y) * 0.006);
      drag.current = { x: e.clientX, y: e.clientY };
    }
    function up() {
      drag.current = null;
    }
    function wheel(e: WheelEvent) {
      e.preventDefault();
      dist.current = Math.max(1.6, Math.min(5.2, dist.current + e.deltaY * 0.002));
    }
    cnv.addEventListener("pointerdown", down);
    cnv.addEventListener("pointermove", move);
    cnv.addEventListener("pointerup", up);
    cnv.addEventListener("wheel", wheel, { passive: false });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      cnv.removeEventListener("pointerdown", down);
      cnv.removeEventListener("pointermove", move);
      cnv.removeEventListener("pointerup", up);
      cnv.removeEventListener("wheel", wheel);
    };
  }, [analysis, job]);

  return (
    <div ref={wrapRef} className="absolute inset-0 min-h-0 min-w-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
    </div>
  );
}
