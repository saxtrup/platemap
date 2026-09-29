import { useEffect, useRef } from "react";
import { divergingRgb, zToT } from "@/lib/colormap";
import { polarToXY } from "@/lib/geometry";
import type { ParallelismResult } from "@/lib/parallelism";
import { idFracOf } from "@/lib/types";

type Vert = { x: number; y: number; depth: number };
type Tri = {
  a: number;
  b: number;
  c: number;
  shade: number;
  color: [number, number, number];
};

const PITCH_MIN = -1.42;
const PITCH_MAX = 1.42;

function clampPitch(p: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));
}

export function ParaView3D({
  result,
  thicknessMm,
  odMm,
  idMm,
  cutClockHours,
}: {
  result: ParallelismResult;
  thicknessMm: number;
  odMm: number;
  idMm: number;
  cutClockHours: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(0.78);
  const pitch = useRef(0.42);
  const dist = useRef(2.85);
  const drag = useRef<{ x: number; y: number } | null>(null);

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

    const hole = idFracOf({ odMm, idMm });
    const idFrac = Math.max(0.03, hole);
    const nr = 20;
    const nt = 64;
    const formScale = Math.max(0.05, result.formScale);
    const thickScale = Math.max(0.02, result.colorScale);
    const formExag = 0.15;
    const halfT = Math.max(0.04, thicknessMm / Math.max(1, odMm));

    type P = { px: number; py: number; h: number; col: [number, number, number] };
    const top: P[] = [];
    const bot: P[] = [];
    const idxAt = (i: number, j: number) => i * nt + (j % nt);

    function formH(z: number): number {
      const hv = Number.isFinite(z) ? Math.max(-1.6 * formScale, Math.min(1.6 * formScale, z)) : 0;
      return (hv / formScale) * formExag;
    }

    for (let i = 0; i <= nr; i++) {
      const t = i / nr;
      const rf = idFrac + (0.995 - idFrac) * t;
      for (let j = 0; j < nt; j++) {
        const th = (j / nt) * Math.PI * 2;
        const px = rf * Math.sin(th);
        const py = rf * Math.cos(th);
        const za = result.formA(px, py);
        const zb = result.formB(px, py);
        const aCol = divergingRgb(zToT(Number.isFinite(za) ? za : 0, formScale));
        const bCol = divergingRgb(zToT(Number.isFinite(zb) ? zb : 0, formScale));
        top.push({ px, py, h: halfT + formH(za), col: aCol });
        bot.push({ px, py, h: -halfT - formH(zb), col: bCol });
      }
    }

    function shadeOf(a: P, b: P, c: P): number {
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
    }

    const tris: Tri[] = [];
    const pushFace = (pts: P[], base: number, flip: boolean) => {
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < nt; j++) {
          const i00 = base + idxAt(i, j);
          const i10 = base + idxAt(i + 1, j);
          const i11 = base + idxAt(i + 1, j + 1);
          const i01 = base + idxAt(i, j + 1);
          const p00 = pts[idxAt(i, j)]!;
          const p10 = pts[idxAt(i + 1, j)]!;
          const p11 = pts[idxAt(i + 1, j + 1)]!;
          const p01 = pts[idxAt(i, j + 1)]!;
          if (flip) {
            tris.push({ a: i00, b: i11, c: i10, shade: shadeOf(p00, p11, p10), color: p10.col });
            tris.push({ a: i00, b: i01, c: i11, shade: shadeOf(p00, p01, p11), color: p00.col });
          } else {
            tris.push({ a: i00, b: i10, c: i11, shade: shadeOf(p00, p10, p11), color: p10.col });
            tris.push({ a: i00, b: i11, c: i01, shade: shadeOf(p00, p11, p01), color: p00.col });
          }
        }
      }
    };

    const positions: P[] = [...top, ...bot];
    const botBase = top.length;
    pushFace(top, 0, false);
    pushFace(bot, botBase, true);

    if (hole <= 0.04) {
      const za0 = result.formA(0, 0);
      const zb0 = result.formB(0, 0);
      const cTop = positions.length;
      positions.push({
        px: 0,
        py: 0,
        h: halfT + formH(za0),
        col: divergingRgb(zToT(Number.isFinite(za0) ? za0 : 0, formScale)),
      });
      const cBot = positions.length;
      positions.push({
        px: 0,
        py: 0,
        h: -halfT - formH(zb0),
        col: divergingRgb(zToT(Number.isFinite(zb0) ? zb0 : 0, formScale)),
      });
      const pC = positions[cTop]!;
      const pCb = positions[cBot]!;
      for (let j = 0; j < nt; j++) {
        const j1 = (j + 1) % nt;
        const i0 = idxAt(0, j);
        const i1 = idxAt(0, j1);
        tris.push({
          a: cTop,
          b: i0,
          c: i1,
          shade: shadeOf(pC, top[i0]!, top[i1]!),
          color: pC.col,
        });
        tris.push({
          a: cBot,
          b: botBase + i1,
          c: botBase + i0,
          shade: shadeOf(pCb, bot[i1]!, bot[i0]!),
          color: pCb.col,
        });
      }
    }

    const wallCol = (j: number): [number, number, number] => {
      const p = top[idxAt(nr, j)]!;
      const thick = result.field(p.px, p.py);
      return divergingRgb(zToT(Number.isFinite(thick) ? thick : 0, thickScale));
    };

    for (let j = 0; j < nt; j++) {
      const j1 = (j + 1) % nt;
      const t0 = idxAt(nr, j);
      const t1 = idxAt(nr, j1);
      const b0 = botBase + t0;
      const b1 = botBase + t1;
      const col = wallCol(j);
      const pT0 = top[t0]!;
      const pT1 = top[t1]!;
      const pB0 = bot[t0]!;
      tris.push({ a: t0, b: b0, c: b1, shade: shadeOf(pT0, pB0, bot[t1]!), color: col });
      tris.push({ a: t0, b: b1, c: t1, shade: shadeOf(pT0, bot[t1]!, pT1), color: col });
    }

    if (hole > 0.04) {
      for (let j = 0; j < nt; j++) {
        const j1 = (j + 1) % nt;
        const t0 = idxAt(0, j);
        const t1 = idxAt(0, j1);
        const b0 = botBase + t0;
        const b1 = botBase + t1;
        const col = wallCol(j);
        tris.push({ a: t0, b: t1, c: b1, shade: 0.55, color: col });
        tris.push({ a: t0, b: b1, c: b0, shade: 0.55, color: col });
      }
    }

    const rimTop: number[] = [];
    const rimBot: number[] = [];
    for (let j = 0; j < nt; j++) {
      rimTop.push(idxAt(nr, j));
      rimBot.push(botBase + idxAt(nr, j));
    }

    const cutTop: { px: number; py: number; h: number }[] = [];
    const cutBot: { px: number; py: number; h: number }[] = [];
    for (let k = 0; k <= 48; k++) {
      const s = (k / 48) * 2 - 1;
      if (Math.abs(s) < idFrac) continue;
      const { x, y } = polarToXY(cutClockHours, s);
      const za = result.formA(x, y);
      const zb = result.formB(x, y);
      cutTop.push({ px: x, py: y, h: halfT + formH(za) + 0.004 });
      cutBot.push({ px: x, py: y, h: -halfT - formH(zb) - 0.004 });
    }

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
      const s = Math.min(W, H) * 0.42;
      return {
        x: W / 2 + right * persp * s,
        y: H * 0.52 - upv * persp * s,
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
          ground.push(project(Math.sin(th), Math.cos(th), -halfT - formExag - 0.03, w, h));
        }
        ctx.beginPath();
        ground.forEach((g, i) => {
          if (i === 0) ctx.moveTo(g.x, g.y);
          else ctx.lineTo(g.x, g.y);
        });
        ctx.closePath();
        ctx.fillStyle = "rgba(0,0,0,0.32)";
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

      const strokeRim = (idxs: number[], alpha: string) => {
        ctx.beginPath();
        idxs.forEach((idx, i) => {
          const p = projected[idx]!;
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.strokeStyle = alpha;
        ctx.lineWidth = 1.15;
        ctx.stroke();
      };
      strokeRim(rimTop, "rgba(232,230,225,0.5)");
      strokeRim(rimBot, "rgba(232,230,225,0.28)");

      if (cutTop.length >= 2) {
        const strokeCut = (pts: { px: number; py: number; h: number }[], alpha: string) => {
          ctx.beginPath();
          pts.forEach((c, i) => {
            const p = project(c.px, c.py, c.h, w, h);
            if (p.depth < 0.3) return;
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.strokeStyle = alpha;
          ctx.lineWidth = 1.1;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        };
        strokeCut(cutTop, "rgba(232,230,225,0.55)");
        strokeCut(cutBot, "rgba(232,230,225,0.28)");
        const a = cutTop[0]!;
        const b = cutTop[cutTop.length - 1]!;
        const aB = cutBot[0]!;
        const bB = cutBot[cutBot.length - 1]!;
        ctx.beginPath();
        const pa = project(a.px, a.py, a.h, w, h);
        const pb = project(aB.px, aB.py, aB.h, w, h);
        const pc = project(b.px, b.py, b.h, w, h);
        const pd = project(bB.px, bB.py, bB.h, w, h);
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.moveTo(pc.x, pc.y);
        ctx.lineTo(pd.x, pd.y);
        ctx.strokeStyle = "rgba(232,230,225,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(168,170,176,0.9)";
      ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = "center";
      for (const hr of [12, 3, 6, 9]) {
        const clock = hr === 12 ? 0 : hr;
        const { x, y } = polarToXY(clock, 1.08);
        const p = project(x, y, halfT + 0.02, w, h);
        if (p.depth > 0.4) ctx.fillText(String(hr), p.x, p.y);
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(139,141,147,0.9)";
      ctx.fillText("Drag to orbit · scroll to zoom · form exaggerated", 16, h - 18);
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
  }, [result, thicknessMm, odMm, idMm, cutClockHours]);

  const formX = Math.round((0.15 * (odMm / 2)) / Math.max(0.05, result.formScale));

  return (
    <div ref={wrapRef} className="absolute inset-0 min-h-0 min-w-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" data-map="para" data-para-scene="3d" />
      <div className="pointer-events-none absolute bottom-8 left-3 rounded-md border border-line bg-surface/90 px-2 py-1 text-2xs text-muted">
        1st face up · 2nd face down · form ×{Number.isFinite(formX) ? formX : "—"}
      </div>
    </div>
  );
}
