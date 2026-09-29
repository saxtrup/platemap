import { useEffect, useRef } from "react";
import type { Analysis } from "@/lib/analysis";
import { divergingRgb, zToT } from "@/lib/colormap";
import { formatClock, formatMm, polarToXY } from "@/lib/geometry";
import { useJobStore } from "@/lib/store";
import { MapView } from "./MapView";
import { Slider } from "./ui/slider";

export function CutView({ analysis }: { analysis: Analysis }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cutClockHours = useJobStore((s) => s.cutClockHours);
  const setCutClock = useJobStore((s) => s.setCutClock);
  const odMm = useJobStore((s) => s.job.odMm);
  const subtractPlane = useJobStore((s) => s.subtractPlane);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    function paint() {
      if (!wrap || !canvas) return;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(32, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0c0d10";
      ctx.fillRect(0, 0, w, h);

      const padL = 52;
      const padR = 18;
      const padT = 22;
      const padB = 36;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      const N = 180;
      const xs: number[] = [];
      const zs: number[] = [];
      for (let i = 0; i <= N; i++) {
        const s = (i / N) * 2 - 1;
        const { x, y } = polarToXY(cutClockHours, s);
        xs.push(s);
        zs.push(analysis.field(x, y));
      }
      const finite = zs.filter(Number.isFinite);
      let zmin = finite.length ? Math.min(...finite) : -0.5;
      let zmax = finite.length ? Math.max(...finite) : 0.5;
      if (zmax === zmin) {
        zmax += 0.2;
        zmin -= 0.2;
      }
      const margin = (zmax - zmin) * 0.12;
      zmin -= margin;
      zmax += margin;

      const X = (s: number) => padL + ((s + 1) / 2) * plotW;
      const Y = (z: number) => padT + ((zmax - z) / (zmax - zmin)) * plotH;

      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = "rgba(139,141,147,0.9)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const span = zmax - zmin;
      const step = niceStep(span / 5);
      const z0 = Math.ceil(zmin / step) * step;
      for (let z = z0; z <= zmax + 1e-9; z += step) {
        const yy = Y(z);
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(padL + plotW, yy);
        ctx.stroke();
        ctx.fillText(formatMm(z, 2), padL - 8, yy);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const s of [-1, -0.5, 0, 0.5, 1]) {
        const xx = X(s);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(xx, padT);
        ctx.lineTo(xx, padT + plotH);
        ctx.stroke();
        const mm = ((s * odMm) / 2).toFixed(0);
        ctx.fillStyle = "rgba(139,141,147,0.9)";
        ctx.fillText(`${mm} mm`, xx, padT + plotH + 8);
      }

      if (zmin < 0 && zmax > 0) {
        ctx.strokeStyle = "rgba(232,230,225,0.2)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, Y(0));
        ctx.lineTo(padL + plotW, Y(0));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      zs.forEach((z, i) => {
        const xx = X(xs[i]!);
        const yy = Y(z);
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      });
      ctx.strokeStyle = "rgba(232,222,210,0.9)";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.lineTo(X(1), Y(Math.max(0, zmin)));
      ctx.lineTo(X(-1), Y(Math.max(0, zmin)));
      ctx.closePath();
      const grd = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grd.addColorStop(0, "rgba(196,98,74,0.18)");
      grd.addColorStop(1, "rgba(74,122,181,0.12)");
      ctx.fillStyle = grd;
      ctx.fill();

      const band = 0.08;
      for (const s of analysis.samples) {
        const { x: ux, y: uy } = polarToXY(cutClockHours, 1);
        const along = s.x * ux + s.y * uy;
        const perp = s.x * uy - s.y * ux;
        if (Math.abs(perp) > band) continue;
        const z = subtractPlane ? s.res : s.z;
        const [r, g, b] = divergingRgb(zToT(z, analysis.colorScale));
        ctx.beginPath();
        ctx.arc(X(along), Y(z), 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
        ctx.strokeStyle = "rgba(12,13,16,0.8)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
    paint();
    return () => ro.disconnect();
  }, [analysis, cutClockHours, odMm, subtractPlane]);

  const opposite = (cutClockHours + 6) % 12;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 md:p-3">
      <div className="flex h-36 shrink-0 items-stretch gap-3 md:h-44">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg bg-bg">
          <MapView analysis={analysis} />
        </div>
        <div className="hidden w-40 shrink-0 flex-col justify-center gap-3 md:flex">
          <div className="text-xs text-muted">
            Cut through{" "}
            <span className="font-mono text-fg tabular-nums">{formatClock(cutClockHours)}</span>
            <span className="text-dim"> — {formatClock(opposite)}</span>
          </div>
          <Slider
            min={0}
            max={12}
            step={0.05}
            value={[cutClockHours]}
            onValueChange={(v) => setCutClock(v[0] ?? 0)}
          />
          <p className="text-2xs text-dim">Drag the diameter on the face, or the slider.</p>
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 rounded-lg bg-bg">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 0.1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / exp;
  if (n < 1.5) return exp;
  if (n < 3.5) return 2 * exp;
  if (n < 7.5) return 5 * exp;
  return 10 * exp;
}
