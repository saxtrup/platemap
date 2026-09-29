import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/analysis";
import { formatClock, formatMm } from "@/lib/geometry";
import { canvasToPolar, drawMap, faceLayout, findHit } from "@/lib/map-render";
import { displayPhotoCandidates, resolvePhotoSrc, PHOTO_IDB_SRC } from "@/lib/persist";
import { useJobStore } from "@/lib/store";
import { idFracOf } from "@/lib/types";
import { PointPopover } from "./PointPopover";

export function MapView({ analysis }: { analysis: Analysis }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: 640 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [loadGen, setLoadGen] = useState(0);
  const imgErrorRef = useRef(false);
  const [hover, setHover] = useState<{ clockHours: number; rFrac: number } | null>(null);
  const [cursor, setCursor] = useState<"default" | "grab" | "grabbing" | "move">("default");
  const heavyRef = useRef(false);

  const points = useJobStore((s) => s.points);
  const photo = useJobStore((s) => s.photo);
  const view = useJobStore((s) => s.view);
  const subtractPlane = useJobStore((s) => s.subtractPlane);
  const showContours = useJobStore((s) => s.showContours);
  const showPoints = useJobStore((s) => s.showPoints);
  const contourStep = useJobStore((s) => s.contourStep);
  const wash = useJobStore((s) => s.wash);
  const selectedId = useJobStore((s) => s.selectedId);
  const draft = useJobStore((s) => s.draft);
  const cutClockHours = useJobStore((s) => s.cutClockHours);
  const photoAdjust = useJobStore((s) => s.photoAdjust);
  const job = useJobStore((s) => s.job);
  const startDraft = useJobStore((s) => s.startDraft);
  const select = useJobStore((s) => s.select);
  const setPhoto = useJobStore((s) => s.setPhoto);
  const setCutClock = useJobStore((s) => s.setCutClock);
  const updatePoint = useJobStore((s) => s.updatePoint);
  const cancelDraft = useJobStore((s) => s.cancelDraft);

  const idFrac = idFracOf(job);
  const showHeatmap = view !== "photo";
  const effectiveWash = view === "photo" ? 100 : wash;

  useEffect(() => {
    setCursor(photoAdjust ? "move" : "default");
  }, [photoAdjust]);

  imgErrorRef.current = imgError;

  useEffect(() => {
    const retry = () => {
      if (imgErrorRef.current) setLoadGen((n) => n + 1);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    setImg(null);
    setImgReady(false);
    setImgError(false);
    if (!photo.src) return;
    let cancelled = false;

    const loadOne = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          if (image.naturalWidth > 0) resolve(image);
          else reject(new Error("empty"));
        };
        image.onerror = () => reject(new Error("error"));
        image.src = src;
      });

    void (async () => {
      const candidates = await displayPhotoCandidates(photo.src);
      for (const src of candidates) {
        if (cancelled) return;
        try {
          const image = await loadOne(src);
          if (cancelled) return;
          setImg(image);
          setImgReady(true);
          setImgError(false);
          if (src !== photo.src && src.startsWith("blob:")) {
            setPhoto({ src });
          }
          return;
        } catch {
          if (src.startsWith("blob:")) {
            const recovered = await resolvePhotoSrc(PHOTO_IDB_SRC);
            if (recovered && !candidates.includes(recovered)) candidates.push(recovered);
          }
        }
      }
      if (!cancelled) {
        setImg(null);
        setImgReady(false);
        setImgError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photo.src, loadGen, setPhoto]);

  const paint = useCallback(
    (heavy: boolean) => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const w = Math.max(32, Math.floor(rect.width));
      const h = Math.max(32, Math.floor(rect.height));
      if (Math.abs(size.w - w) > 1 || Math.abs(size.h - h) > 1) setSize({ w, h });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        drawMap(ctx, {
          width: w,
          height: h,
          dpr,
          analysis,
          points,
          photo,
          photoImage: img,
          photoReady: imgReady,
          subtractPlane,
          showContours: showContours && heavy,
          showPoints,
          showHeatmap: showHeatmap && heavy,
          contourStep,
          wash: effectiveWash,
          selectedId,
          draft,
          cutClockHours,
          showCut: view === "cut",
          jobName: job.name,
          odMm: job.odMm,
          idFrac,
          dialUnitMm: job.dialUnitMm,
        });
      } catch {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#1a1c22";
        const { cx, cy, R } = faceLayout(w, h);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(232,230,225,0.38)";
        ctx.stroke();
      }
    },
    [
      analysis,
      points,
      photo,
      img,
      imgReady,
      subtractPlane,
      showContours,
      showPoints,
      showHeatmap,
      contourStep,
      effectiveWash,
      selectedId,
      draft,
      cutClockHours,
      view,
      job,
      idFrac,
      size.w,
      size.h,
    ],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    heavyRef.current = false;
    const run = () => {
      paint(heavyRef.current);
      if (!heavyRef.current) {
        heavyRef.current = true;
        requestAnimationFrame(() => paint(true));
      }
    };
    const ro = new ResizeObserver(run);
    ro.observe(wrap);
    run();
    const t = window.setTimeout(run, 60);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [paint]);

  const drag = useRef<{
    mode: "photo" | "cut" | "point" | "tap" | null;
    id: string | null;
    lx: number;
    ly: number;
    x: number;
    y: number;
    moved: boolean;
  }>({ mode: null, id: null, lx: 0, ly: 0, x: 0, y: 0, moved: false });

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (photoAdjust && photo.src) {
      drag.current = { mode: "photo", id: null, lx: e.clientX, ly: e.clientY, x, y, moved: false };
      setCursor("move");
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (view === "cut") {
      const polar = canvasToPolar(x, y, size.w, size.h, idFrac);
      if (polar.inside) {
        setCutClock(polar.clockHours);
        drag.current = { mode: "cut", id: null, lx: e.clientX, ly: e.clientY, x, y, moved: false };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = showPoints ? findHit(x, y, size.w, size.h, points) : null;
    if (hit) {
      e.preventDefault();
      cancelDraft();
      select(hit);
      drag.current = { mode: "point", id: hit, lx: e.clientX, ly: e.clientY, x, y, moved: false };
      setCursor("grabbing");
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    e.preventDefault();
    drag.current = { mode: "tap", id: null, lx: e.clientX, ly: e.clientY, x, y, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const polar = canvasToPolar(x, y, size.w, size.h, 0);
    setHover(polar.inside ? polar : null);

    if (drag.current.mode === "photo") {
      const cxR = Math.min(size.w, size.h) / 2;
      const dx = (e.clientX - drag.current.lx) / (cxR || 1);
      const dy = (e.clientY - drag.current.ly) / (cxR || 1);
      drag.current.lx = e.clientX;
      drag.current.ly = e.clientY;
      setPhoto({ panX: photo.panX + dx, panY: photo.panY + dy });
      return;
    }
    if (drag.current.mode === "cut") {
      if (polar.inside) setCutClock(polar.clockHours);
      return;
    }
    if (drag.current.mode === "point" && drag.current.id) {
      const dist = Math.hypot(e.clientX - drag.current.lx, e.clientY - drag.current.ly);
      if (dist > 4) drag.current.moved = true;
      const next = canvasToPolar(x, y, size.w, size.h, 0);
      const rFrac = Math.max(0, Math.min(1, next.rFrac));
      updatePoint(drag.current.id, { clockHours: next.clockHours, rFrac });
      return;
    }
    if (drag.current.mode == null && !photoAdjust) {
      const over = showPoints ? findHit(x, y, size.w, size.h, points) : null;
      setCursor(over ? "grab" : "default");
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const mode = drag.current.mode;
    const sx = drag.current.x;
    const sy = drag.current.y;
    const id = drag.current.id;
    const dragged = drag.current.moved;
    drag.current.mode = null;
    drag.current.id = null;
    drag.current.moved = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    setCursor(photoAdjust ? "move" : "default");
    if (mode === "point") {
      if (!dragged && id) {
        const p = points.find((pt) => pt.id === id);
        if (p) startDraft(p.clockHours, p.rFrac, p.id);
      }
      return;
    }
    if (mode !== "tap") return;
    const moved = Math.hypot(e.clientX - drag.current.lx, e.clientY - drag.current.ly);
    if (moved > 8) return;
    const hit = findHit(sx, sy, size.w, size.h, points);
    if (hit) {
      const p = points.find((pt) => pt.id === hit);
      if (p) startDraft(p.clockHours, p.rFrac, p.id);
      return;
    }
    const polar = canvasToPolar(sx, sy, size.w, size.h, 0);
    if (polar.inside && polar.rFrac <= 1.02) {
      startDraft(polar.clockHours, Math.min(1, polar.rFrac), null);
    } else {
      select(null);
    }
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!photo.src || !photoAdjust) return;
    e.preventDefault();
    const fine = e.shiftKey || e.altKey;
    const step = fine ? 0.004 : 0.01;
    const dir = e.deltaY > 0 ? -1 : 1;
    const next = Math.max(0.4, Math.min(3, photo.scale + dir * step));
    setPhoto({ scale: Math.round(next * 1000) / 1000 });
  }

  const hoverZ = useMemo(() => {
    if (!hover || analysis.n < 1) return null;
    const th = (hover.clockHours / 12) * Math.PI * 2;
    const x = hover.rFrac * Math.sin(th);
    const y = hover.rFrac * Math.cos(th);
    return analysis.field(x, y);
  }, [hover, analysis]);

  const draftPos = draft
    ? (() => {
        const { clockHours, rFrac } = draft;
        const th = (clockHours / 12) * Math.PI * 2;
        const { cx, cy, R } = faceLayout(size.w, size.h);
        return {
          x: cx + Math.sin(th) * rFrac * R,
          y: cy - Math.cos(th) * rFrac * R,
        };
      })()
    : null;

  return (
    <div ref={wrapRef} className="absolute inset-0 min-h-0 min-w-0">
      {photo.src ? (
        <img
          src={photo.src}
          alt=""
          className="pointer-events-none absolute h-px w-px opacity-0"
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth > 0) {
              setImg(el);
              setImgReady(true);
            }
          }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        data-map="face"
        tabIndex={-1}
        className="block h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(null);
          if (drag.current.mode == null) setCursor(photoAdjust ? "move" : "default");
        }}
        onWheel={onWheel}
      />
      {hover && !draft && (
        <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-bg/80 px-2 py-1 font-mono text-xs text-muted tabular-nums">
          {formatClock(hover.clockHours)} · {Math.round(hover.rFrac * 100)}%
          {hoverZ != null && Number.isFinite(hoverZ) ? ` · ${formatMm(hoverZ)} mm` : ""}
        </div>
      )}
      {view === "photo" && !imgReady && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-md bg-bg/80 px-3 py-2 text-sm text-muted">
            {imgError
              ? "Photo failed to load — try Import"
              : photo.src
                ? "Loading photo…"
                : "Import a photo of the face"}
          </p>
        </div>
      )}
      {photoAdjust ? (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-bg/80 px-2 py-1 text-xs text-muted">
          Drag to pan · scroll 1% · shift-scroll 0.4%
        </div>
      ) : (
        showPoints &&
        points.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-bg/80 px-2 py-1 text-xs text-muted">
            Drag a reading to move it · tap to edit
          </div>
        )
      )}
      {draft && draftPos && <PointPopover x={draftPos.x} y={draftPos.y} wrapW={size.w} wrapH={size.h} />}
    </div>
  );
}
