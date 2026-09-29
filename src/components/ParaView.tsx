import { useEffect, useRef, useState } from "react";
import { canvasToPolar } from "@/lib/map-render";
import {
  drawParaMap,
  drawScanChart,
  drawThicknessCut,
} from "@/lib/para-render";
import {
  formatCorrespondence,
  formatOffsetHours,
  type ParallelismResult,
} from "@/lib/parallelism";
import { formatClock, formatMm, polarToXY } from "@/lib/geometry";
import { PLATE_PAIRS } from "@/lib/demo";
import { useJobStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ParaView3D } from "./ParaView3D";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

export function ParaView({ result }: { result: ParallelismResult | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const cutRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ clock: string; z: string } | null>(null);
  const [scene, setScene] = useState<"map" | "3d">("map");

  const points = useJobStore((s) => s.points);
  const faceB = useJobStore((s) => s.faceB);
  const job = useJobStore((s) => s.job);
  const showContours = useJobStore((s) => s.showContours);
  const showPoints = useJobStore((s) => s.showPoints);
  const contourStep = useJobStore((s) => s.contourStep);
  const wash = useJobStore((s) => s.wash);
  const cutClockHours = useJobStore((s) => s.cutClockHours);
  const setCutClock = useJobStore((s) => s.setCutClock);
  const thicknessMm = useJobStore((s) => s.thicknessMm);
  const paraAuto = useJobStore((s) => s.paraAuto);
  const paraOffsetHours = useJobStore((s) => s.paraOffsetHours);
  const setParaOffsetHours = useJobStore((s) => s.setParaOffsetHours);
  const setParaAuto = useJobStore((s) => s.setParaAuto);
  const loadPlatePair = useJobStore((s) => s.loadPlatePair);

  const flip = result?.flip ?? "none";
  const offset = paraAuto ? (result?.offsetHours ?? 0) : paraOffsetHours;
  const ready = Boolean(result?.ready && faceB && faceB.points.length >= 3 && points.length >= 3);

  useEffect(() => {
    if (scene !== "map") return;
    const wrap = wrapRef.current;
    const map = mapRef.current;
    if (!wrap || !map) return;

    function paint() {
      if (!wrap || !map) return;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(32, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      map.width = Math.floor(w * dpr);
      map.height = Math.floor(h * dpr);
      map.style.width = `${w}px`;
      map.style.height = `${h}px`;
      const ctx = map.getContext("2d");
      if (!ctx || !result) return;
      drawParaMap(ctx, {
        width: w,
        height: h,
        dpr,
        result,
        pointsA: points,
        pointsB: faceB?.points ?? [],
        flip,
        offsetHours: offset,
        showPoints,
        showContours,
        contourStep,
        wash,
        cutClockHours,
        thicknessMm,
        dialUnitMm: job.dialUnitMm,
      });
    }

    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
    paint();
    return () => ro.disconnect();
  }, [
    result,
    points,
    faceB,
    flip,
    offset,
    showPoints,
    showContours,
    contourStep,
    wash,
    cutClockHours,
    thicknessMm,
    job.dialUnitMm,
    scene,
  ]);

  useEffect(() => {
    const canvas = cutRef.current;
    if (!canvas || !result) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    function paint() {
      if (!canvas || !parent || !result) return;
      const rect = parent.getBoundingClientRect();
      const w = Math.max(32, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawThicknessCut(ctx, w, h, dpr, result, cutClockHours, thicknessMm);
    }
    const ro = new ResizeObserver(paint);
    ro.observe(parent);
    paint();
    return () => ro.disconnect();
  }, [result, cutClockHours, thicknessMm]);

  useEffect(() => {
    const canvas = scanRef.current;
    if (!canvas || !result) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    function paint() {
      if (!canvas || !parent || !result) return;
      const rect = parent.getBoundingClientRect();
      const w = Math.max(32, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawScanChart(ctx, w, h, dpr, result.scan, offset);
    }
    const ro = new ResizeObserver(paint);
    ro.observe(parent);
    paint();
    return () => ro.disconnect();
  }, [result, offset]);

  if (!ready) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="max-w-sm">
          <h2 className="text-sm font-medium text-fg">Two faces, one thickness</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Load dial maps of both sides. Because the plate is about {thicknessMm} mm thick, the
            two height maps should be near-opposites once the clocks line up — that is how the
            rotation is found.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          {PLATE_PAIRS.map((pair) => (
            <Button
              key={pair.id}
              variant={pair.id === "new" ? "default" : "outline"}
              onClick={() => loadPlatePair(pair.id)}
            >
              Load {pair.label}
            </Button>
          ))}
        </div>
        <p className="text-2xs text-dim">or import a second-face CSV from the panel</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {scene === "3d" && result ? (
          <ParaView3D
            result={result}
            thicknessMm={thicknessMm}
            odMm={job.odMm}
            idMm={job.idMm}
            cutClockHours={cutClockHours}
          />
        ) : (
          <div ref={wrapRef} className="absolute inset-0">
            <canvas
              ref={mapRef}
              className="h-full w-full touch-none"
              data-map="para"
              onPointerDown={(e) => {
                const canvas = mapRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const polar = canvasToPolar(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
                if (polar.inside) setCutClock(polar.clockHours);
              }}
              onPointerMove={(e) => {
                const canvas = mapRef.current;
                if (!canvas || !result) return;
                const rect = canvas.getBoundingClientRect();
                const polar = canvasToPolar(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
                if (!polar.inside) {
                  setHover(null);
                  return;
                }
                const { x, y } = polarToXY(polar.clockHours, polar.rFrac);
                const z = result.field(x, y);
                setHover({
                  clock: `${Math.round(polar.rFrac * 100)}% · ${formatClock(polar.clockHours)}`,
                  z: Number.isFinite(z)
                    ? `${formatMm(z)} mm  (${(thicknessMm + z).toFixed(2)} mm thick)`
                    : "—",
                });
              }}
              onPointerLeave={() => setHover(null)}
            />
          </div>
        )}
        <div className="absolute top-3 left-3 z-10 flex rounded-md border border-line bg-surface/90 p-0.5">
          <button
            type="button"
            className={cn(
              "h-8 min-w-11 rounded-sm px-2.5 text-xs",
              scene === "map" ? "bg-bg text-fg" : "text-muted hover:text-fg",
            )}
            onClick={() => setScene("map")}
          >
            Map
          </button>
          <button
            type="button"
            className={cn(
              "h-8 min-w-11 rounded-sm px-2.5 text-xs",
              scene === "3d" ? "bg-bg text-fg" : "text-muted hover:text-fg",
            )}
            onClick={() => setScene("3d")}
          >
            3D
          </button>
        </div>
        {scene === "map" && hover && (
          <div className="pointer-events-none absolute top-14 left-3 rounded-md border border-line bg-surface/90 px-2 py-1 font-mono text-2xs text-fg tabular-nums">
            {hover.z}
            <span className="ml-2 text-dim">{hover.clock}</span>
          </div>
        )}
        {result && (
          <div className="pointer-events-none absolute top-3 right-3 max-w-[16rem] rounded-md border border-line bg-surface/90 px-2 py-1.5 text-right">
            <div className="font-mono text-2xs text-fg tabular-nums">
              {formatCorrespondence(result.clockBAt12)}
            </div>
            <div className="text-2xs text-muted">{formatOffsetHours(offset)}</div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface">
        <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="bg-surface p-3">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">2nd-face rotation</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-fg tabular-nums">{formatOffsetHours(offset)}</span>
                {!paraAuto ? (
                  <Button size="sm" variant="outline" onClick={() => setParaAuto(true)}>
                    Auto
                  </Button>
                ) : (
                  <span className="text-2xs text-muted">Auto</span>
                )}
              </div>
            </div>
            <Slider
              min={0}
              max={12}
              step={0.05}
              value={[offset]}
              onValueChange={(a) => setParaOffsetHours(a[0] ?? offset)}
            />
            <div className="mt-2 h-14">
              <canvas
                ref={scanRef}
                className="h-full w-full cursor-pointer"
                onPointerDown={(e) => {
                  const canvas = scanRef.current;
                  if (!canvas) return;
                  const rect = canvas.getBoundingClientRect();
                  const t = (e.clientX - rect.left) / rect.width;
                  setParaOffsetHours(Math.max(0, Math.min(12, t * 12)));
                }}
              />
            </div>
            <p className="mt-1 text-2xs text-dim">
              Low on the curve = more even thickness. Circles 1st face, diamonds 2nd.
            </p>
          </div>
          <div className="h-36 bg-bg lg:h-auto">
            <canvas ref={cutRef} className="h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
