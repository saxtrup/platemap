import { useEffect, useMemo, useState } from "react";
import { Box, Camera, Layers, Map as MapIcon, Menu, Spline, X } from "lucide-react";
import { analyze } from "@/lib/analysis";
import { parseJobText } from "@/lib/csv";
import { formatMm } from "@/lib/geometry";
import { analyzeParallelism } from "@/lib/parallelism";
import { photoSrcFromFile } from "@/lib/persist";
import { useJobStore } from "@/lib/store";
import { CutView } from "./CutView";
import { MapView } from "./MapView";
import { ParaView } from "./ParaView";
import { Sidebar } from "./Sidebar";
import { View3D } from "./View3D";
import { ViewGuard } from "./ViewGuard";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/types";

const MOBILE_VIEWS: { id: ViewMode; label: string; icon: typeof MapIcon }[] = [
  { id: "map", label: "Map", icon: MapIcon },
  { id: "photo", label: "Photo", icon: Camera },
  { id: "3d", label: "3D", icon: Box },
  { id: "cut", label: "Cut", icon: Spline },
  { id: "para", label: "Para", icon: Layers },
];

export function AppShell() {
  const job = useJobStore((s) => s.job);
  const points = useJobStore((s) => s.points);
  const subtractPlane = useJobStore((s) => s.subtractPlane);
  const view = useJobStore((s) => s.view);
  const hydrate = useJobStore((s) => s.hydrate);
  const importText = useJobStore((s) => s.importText);
  const importFaceB = useJobStore((s) => s.importFaceB);
  const setPhoto = useJobStore((s) => s.setPhoto);
  const setView = useJobStore((s) => s.setView);
  const faceB = useJobStore((s) => s.faceB);
  const paraAuto = useJobStore((s) => s.paraAuto);
  const paraFlip = useJobStore((s) => s.paraFlip);
  const paraOffsetHours = useJobStore((s) => s.paraOffsetHours);
  const [panel, setPanel] = useState(false);
  const [dropOver, setDropOver] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const analysis = useMemo(
    () => analyze(points, job, subtractPlane),
    [points, job, subtractPlane],
  );

  const para = useMemo(() => {
    if (!faceB || faceB.points.length < 3 || points.length < 3) return null;
    return analyzeParallelism(points, faceB.points, job, faceB.job, {
      flip: paraFlip,
      offsetHours: paraAuto ? "auto" : paraOffsetHours,
    });
  }, [points, job, faceB, paraFlip, paraAuto, paraOffsetHours]);

  async function ingestFile(file: File) {
    const name = file.name.toLowerCase();
    const looksTable = /\.(csv|json|txt)$/i.test(name) || /csv|json|text\/plain/.test(file.type);
    const looksImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);
    if (looksImage && !looksTable) {
      setPhoto({ src: photoSrcFromFile(file), scale: 1, panX: 0, panY: 0, rotationDeg: 0 });
      setView("photo");
      toast("Photo loaded");
      return;
    }
    const text = await file.text();
    const asSecond =
      view === "para" && (name.includes("2nd") || name.includes("second") || (faceB == null && points.length > 0));
    if (asSecond) {
      const n = importFaceB(text);
      if (!n) {
        toast.error(parseJobText(text) ? "No readings in that file" : "Could not parse that file");
        return;
      }
      toast(`2nd face · ${n} readings`);
      return;
    }
    const n = importText(text);
    if (!n) {
      toast.error(parseJobText(text) ? "No readings in that file" : "Could not parse that file");
      return;
    }
    toast(`Imported ${n} readings`);
  }

  return (
    <div
      className="relative flex h-dvh flex-col bg-bg text-fg"
      onDragOver={(e) => {
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void ingestFile(f);
      }}
    >
      {dropOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-bg/70">
          <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm">
            Drop CSV, JSON or a photo
          </p>
        </div>
      )}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-3">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-sm font-medium tracking-tight">FormTopo</span>
        </div>
        <div className="hidden min-w-0 truncate text-sm text-muted sm:block">
          {job.name}
          <span className="text-dim">
            {" "}
            · Ø{job.odMm}
            {job.idMm > 0 ? `/${job.idMm}` : ""} mm
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-xs tabular-nums">
          {view === "para" && para?.ready ? (
            <>
              <span className="text-muted">
                {para.nA}+{para.nB} pts
              </span>
              <span className="hidden text-muted sm:inline">
                Match {Math.round(Math.max(0, para.corr) * 100)}%
              </span>
              <span className="text-fg">Para {para.thicknessPv.toFixed(2)} mm</span>
            </>
          ) : (
            <>
              <span className="text-muted">{analysis.n} pts</span>
              <span className="hidden text-muted sm:inline">
                P–V {analysis.peakValley.toFixed(2)} mm
              </span>
              <span className="text-fg">Flat {analysis.flatness.toFixed(2)} mm</span>
            </>
          )}
          <Button
            size="iconSm"
            variant="ghost"
            className="lg:hidden"
            aria-label="Readings"
            onClick={() => setPanel((v) => !v)}
          >
            {panel ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-line px-2 py-1 lg:hidden">
            {MOBILE_VIEWS.map((v) => {
              const Icon = v.icon;
              const on = view === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={cn(
                    "flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-2xs",
                    on ? "bg-surface text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  {v.label}
                </button>
              );
            })}
          </div>
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {view === "3d" ? (
              <ViewGuard>
                <View3D analysis={analysis} />
              </ViewGuard>
            ) : view === "cut" ? (
              <ViewGuard>
                <CutView analysis={analysis} />
              </ViewGuard>
            ) : view === "para" ? (
              <ViewGuard>
                <ParaView result={para} />
              </ViewGuard>
            ) : (
              <ViewGuard>
                <MapView analysis={analysis} />
              </ViewGuard>
            )}
            {view !== "cut" && view !== "para" && points.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-md bg-bg/70 px-3 py-2 text-sm text-muted">
                  Tap the face to add a dial reading
                </p>
              </div>
            )}
          </div>
          {view !== "cut" && view !== "3d" && view !== "para" && (
            <div className="grid shrink-0 grid-cols-4 gap-px border-t border-line bg-line lg:hidden">
              <MobileStat label="P–V" value={`${analysis.peakValley.toFixed(2)}`} />
              <MobileStat label="Flat" value={`${analysis.flatness.toFixed(2)}`} />
              <MobileStat label="Tilt" value={`${analysis.tiltDeg.toFixed(2)}°`} />
              <MobileStat label="Bowl" value={formatMm(analysis.bowlMm)} />
            </div>
          )}
        </main>

        <div className="hidden w-80 shrink-0 border-l border-line lg:block">
          <Sidebar analysis={analysis} para={para} />
        </div>

        {panel && (
          <div className="absolute inset-0 z-30 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-bg/60"
              aria-label="Close panel"
              onClick={() => setPanel(false)}
            />
            <div className="absolute inset-y-0 right-0 w-[min(100%,20rem)] border-l border-line shadow-2xl">
              <Sidebar analysis={analysis} para={para} onClose={() => setPanel(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MobileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-2 py-2 text-center">
      <div className="text-2xs text-dim">{label}</div>
      <div className="font-mono text-xs text-fg tabular-nums">{value}</div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.2 10.2c1.4-2.2 3.2-3.4 4.8-3.4 1.8 0 3.2 1.6 5 4"
        fill="none"
        stroke="currentColor"
        className="text-low"
        strokeWidth="1.1"
      />
      <path
        d="M5 7.4c1.6 1.8 3.2 2.4 5.1 1.4 1.3-.7 2.4-1 3.6-.6"
        fill="none"
        stroke="currentColor"
        className="text-high"
        strokeWidth="1.1"
      />
    </svg>
  );
}
