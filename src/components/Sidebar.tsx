import { useRef, useState } from "react";
import { Box, Camera, Copy, Download, Layers, Map as MapIcon, Spline, Upload, X } from "lucide-react";
import type { Analysis } from "@/lib/analysis";
import {
  FLIP_LABEL,
  formatCorrespondence,
  formatOffsetHours,
  type ParallelismResult,
} from "@/lib/parallelism";
import type { FlipSetting } from "@/lib/types";
import { colorBarCss } from "@/lib/colormap";
import { parseJobText, serializeCsv, serializeJson } from "@/lib/csv";
import { canvasPngDataUrl, copyText, dataUrlToBlob, downloadBlob, slug } from "@/lib/export";
import { formatClock, formatMm } from "@/lib/geometry";
import { photoSrcFromFile } from "@/lib/persist";
import { useJobStore } from "@/lib/store";
import { PLATE_PAIRS } from "@/lib/demo";
import { DIAL_UNITS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { toast } from "sonner";

const VIEWS = [
  { id: "map", label: "Map", icon: MapIcon },
  { id: "photo", label: "Photo", icon: Camera },
  { id: "3d", label: "3D", icon: Box },
  { id: "cut", label: "Cut", icon: Spline },
  { id: "para", label: "Para", icon: Layers },
] as const;

type ExportKind = "csv" | "json" | "png";
type ExportPayload = { kind: ExportKind; filename: string; text?: string; dataUrl?: string };

export function Sidebar({
  analysis,
  para,
  onClose,
}: {
  analysis: Analysis;
  para: ParallelismResult | null;
  onClose?: () => void;
}) {
  const job = useJobStore((s) => s.job);
  const setJob = useJobStore((s) => s.setJob);
  const points = useJobStore((s) => s.points);
  const view = useJobStore((s) => s.view);
  const setView = useJobStore((s) => s.setView);
  const subtractPlane = useJobStore((s) => s.subtractPlane);
  const setSubtractPlane = useJobStore((s) => s.setSubtractPlane);
  const showContours = useJobStore((s) => s.showContours);
  const setShowContours = useJobStore((s) => s.setShowContours);
  const showPoints = useJobStore((s) => s.showPoints);
  const setShowPoints = useJobStore((s) => s.setShowPoints);
  const contourStep = useJobStore((s) => s.contourStep);
  const setContourStep = useJobStore((s) => s.setContourStep);
  const wash = useJobStore((s) => s.wash);
  const setWash = useJobStore((s) => s.setWash);
  const selectedId = useJobStore((s) => s.selectedId);
  const startDraft = useJobStore((s) => s.startDraft);
  const removePoint = useJobStore((s) => s.removePoint);
  const photoAdjust = useJobStore((s) => s.photoAdjust);
  const setPhotoAdjust = useJobStore((s) => s.setPhotoAdjust);
  const photo = useJobStore((s) => s.photo);
  const setPhoto = useJobStore((s) => s.setPhoto);
  const loadDemo = useJobStore((s) => s.loadDemo);
  const loadPlatePair = useJobStore((s) => s.loadPlatePair);
  const resetJob = useJobStore((s) => s.resetJob);
  const replacePoints = useJobStore((s) => s.replacePoints);
  const importText = useJobStore((s) => s.importText);
  const saveState = useJobStore((s) => s.saveState);
  const savedAt = useJobStore((s) => s.savedAt);
  const fileRef = useRef<HTMLInputElement>(null);
  const [exp, setExp] = useState<ExportPayload | null>(null);
  const [imp, setImp] = useState(false);

  function openExport(kind: ExportKind) {
    const name = slug(job.name);
    const snap = { job, points, photo };
    if (kind === "csv") {
      const text = serializeCsv(snap);
      setExp({ kind, filename: `${name}.csv`, text });
      void copyText(text).then((ok) => {
        if (ok) toast("CSV copied — Save file if you need a copy on disk");
      });
      return;
    }
    if (kind === "json") {
      const text = serializeJson(snap);
      setExp({ kind, filename: `${name}.json`, text });
      void copyText(text).then((ok) => {
        if (ok) toast("JSON copied — Save file if you need a copy on disk");
      });
      return;
    }
    const canvas = document.querySelector<HTMLCanvasElement>(
      view === "para" ? "canvas[data-map='para']" : "canvas[data-map='face']",
    );
    const dataUrl = canvasPngDataUrl(canvas);
    if (!dataUrl) {
      toast.error("Nothing to export yet");
      return;
    }
    setExp({ kind: "png", filename: `${name}.png`, dataUrl });
  }

  async function onPickFile(file: File) {
    const name = file.name.toLowerCase();
    const looksTable = /\.(csv|json|txt)$/i.test(name) || /csv|json|text\/plain/.test(file.type);
    const looksImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);
    if (looksImage && !looksTable) {
      setPhoto({ src: photoSrcFromFile(file), scale: 1, panX: 0, panY: 0, rotationDeg: 0 });
      setView("photo");
      toast("Photo loaded — tap the face to add readings");
      setImp(false);
      return;
    }
    const text = await file.text();
    const n = importText(text);
    if (!n) {
      const parsed = parseJobText(text);
      toast.error(parsed ? "No readings in that file" : "Could not parse that file");
      return;
    }
    toast(`Imported ${n} readings`);
    setImp(false);
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed — export a copy"
        : savedAt
          ? `Saved · ${points.length} pts`
          : "Autosave on";

  return (
    <aside className="relative flex h-full min-h-0 w-full flex-col bg-surface text-fg">
      <div className="flex shrink-0 gap-1 border-b border-line p-2">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const on = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setView(v.id);
                onClose?.();
              }}
              className={cn(
                "flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-2xs",
                on ? "bg-bg text-fg" : "text-muted hover:bg-bg/60 hover:text-fg",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {view === "para" ? (
          <ParaControls para={para} />
        ) : (
          <>
        <Section label="Job">
          <Field label="Name">
            <Input value={job.name} onChange={(e) => setJob({ name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Outside Ø">
              <div className="relative">
                <Input
                  type="number"
                  value={job.odMm}
                  onChange={(e) => setJob({ odMm: Number(e.target.value) || 0 })}
                />
                <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-dim">
                  mm
                </span>
              </div>
            </Field>
            <Field label="Bore Ø">
              <div className="relative">
                <Input
                  type="number"
                  value={job.idMm}
                  onChange={(e) => setJob({ idMm: Number(e.target.value) || 0 })}
                />
                <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-dim">
                  mm
                </span>
              </div>
            </Field>
            <Field label="1 dial div">
              <select
                className="h-8 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg"
                value={String(job.dialUnitMm)}
                onChange={(e) => setJob({ dialUnitMm: Number(e.target.value) })}
              >
                {DIAL_UNITS.map((u) => (
                  <option key={u.label} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section label="Deviation">
          <div className="mb-2 h-2 w-full rounded-full" style={{ background: colorBarCss() }} />
          <div className="mb-3 flex justify-between font-mono text-2xs text-muted tabular-nums">
            <span>-{analysis.colorScale.toFixed(2)} mm</span>
            <span>0</span>
            <span>+{analysis.colorScale.toFixed(2)} mm</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Peak–valley" value={`${analysis.peakValley.toFixed(2)} mm`} />
            <Stat label="Flatness*" value={`${analysis.flatness.toFixed(2)} mm`} />
            <Stat label="High" value={formatMm(analysis.high)} accent="high" />
            <Stat label="Low" value={formatMm(analysis.low)} accent="low" />
            <Stat
              label="Tilt"
              value={`${analysis.tiltDeg.toFixed(3)}°`}
              hint={`${formatClock(analysis.tiltClockHours)} uphill`}
            />
            <Stat label="Bowl" value={formatMm(analysis.bowlMm)} hint={analysis.bowlKind} />
          </div>
          <p className="mt-2 text-2xs leading-snug text-dim">
            *Least-squares plane removed. Dial zero is the colour origin.
          </p>
        </Section>

        <Section label="">
          <ToggleRow label="Subtract plane" checked={subtractPlane} onChange={setSubtractPlane} />
          <ToggleRow label="Contours" checked={showContours} onChange={setShowContours} />
          <ToggleRow label="Point marks" checked={showPoints} onChange={setShowPoints} />
          <ToggleRow label="Adjust photo" checked={photoAdjust} onChange={setPhotoAdjust} />
          <div className="mt-3 space-y-3">
            <SliderRow
              label="Step"
              value={contourStep.toFixed(2)}
              min={0.01}
              max={0.25}
              step={0.01}
              v={contourStep}
              onChange={setContourStep}
            />
            <SliderRow
              label="Wash"
              value={`${Math.round(wash)}%`}
              min={0}
              max={90}
              step={1}
              v={wash}
              onChange={setWash}
            />
            <SliderRow
              label="Photo zoom"
              value={`${(photo.scale * 100).toFixed(1)}%`}
              min={0.5}
              max={2.5}
              step={0.005}
              v={photo.scale}
              onChange={(n) => setPhoto({ scale: Math.round(n * 1000) / 1000 })}
            />
            <SliderRow
              label="Photo rotate"
              value={`${photo.rotationDeg.toFixed(1)}°`}
              min={-15}
              max={15}
              step={0.1}
              v={photo.rotationDeg}
              onChange={(n) => setPhoto({ rotationDeg: Math.round(n * 10) / 10 })}
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setPhoto({ scale: Math.round((photo.scale - 0.01) * 1000) / 1000 })}
              >
                −1%
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setPhoto({ scale: Math.round((photo.scale + 0.01) * 1000) / 1000 })}
              >
                +1%
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1"
                onClick={() => setPhoto({ scale: 1, panX: 0, panY: 0, rotationDeg: 0 })}
              >
                Fit
              </Button>
            </div>
          </div>
        </Section>

        <Section label={`${points.length} readings`}>
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-left font-mono text-2xs tabular-nums">
              <thead className="bg-bg text-dim">
                <tr>
                  <th className="px-1.5 py-1 font-medium">CLK</th>
                  <th className="px-1.5 py-1 font-medium">R</th>
                  <th className="px-1.5 py-1 font-medium">DIAL</th>
                  <th className="px-1.5 py-1 font-medium">MM</th>
                </tr>
              </thead>
            </table>
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-left font-mono text-2xs tabular-nums">
                <tbody>
                  {points.map((p) => {
                    const on = p.id === selectedId;
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          "cursor-pointer border-t border-line/60",
                          on ? "bg-bg text-fg" : "text-muted hover:bg-bg/70",
                        )}
                        onClick={() => startDraft(p.clockHours, p.rFrac, p.id)}
                        onDoubleClick={() => removePoint(p.id)}
                      >
                        <td className="px-1.5 py-1">{formatClock(p.clockHours)}</td>
                        <td className="px-1.5 py-1">{Math.round(p.rFrac * 100)}% </td>
                        <td className="px-1.5 py-1">{p.dial}</td>
                        <td className="px-1.5 py-1">{formatMm(p.dial * job.dialUnitMm)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-1 text-2xs text-dim">
            Drag a reading to align · tap to edit · double-click a row to delete
          </p>
        </Section>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-line p-3">
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="outline" onClick={() => openExport("csv")}>
            CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => openExport("json")}>
            JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => openExport("png")}>
            PNG
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImp(true)}>
            <Upload className="size-3.5" />
            Import
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (loadPlatePair("original")) {
                toast("Loaded 1st & 2nd face");
                onClose?.();
              } else {
                toast.error("Could not load the plate pair");
              }
            }}
          >
            Both faces
          </Button>
          <Button size="sm" variant="ghost" onClick={loadDemo}>
            Sample plate
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          onClick={() => {
            if (points.length || photo.src) {
              if (!window.confirm("Clear this job? Readings and the plate photo will be removed.")) {
                return;
              }
            }
            resetJob();
          }}
        >
          Reset
        </Button>
        <p
          className={cn(
            "text-2xs",
            saveState === "error" ? "text-high" : "text-dim",
          )}
        >
          {saveLabel}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.csv,.json,text/csv,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {exp && <ExportPanel payload={exp} onClose={() => setExp(null)} />}
      {imp && (
        <ImportPanel
          fileRef={fileRef}
          onClose={() => setImp(false)}
          onPickFile={(f) => void onPickFile(f)}
          onPaste={(text) => {
            const n = importText(text);
            if (!n) {
              toast.error("Could not parse that CSV / JSON");
              return;
            }
            toast(`Imported ${n} readings`);
            setImp(false);
          }}
        />
      )}
    </aside>
  );
}

function ImportPanel({
  onClose,
  onPickFile,
  onPaste,
  fileRef,
}: {
  onClose: () => void;
  onPickFile: (file: File) => void;
  onPaste: (text: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState("");
  const [dropOver, setDropOver] = useState(false);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-surface/95 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Import readings</h2>
        <Button size="iconSm" variant="ghost" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Paste a CSV or JSON export, drop a file, or pick one from disk.
      </p>
      <textarea
        className="min-h-0 flex-1 resize-none rounded-md border border-line bg-bg p-2 font-mono text-2xs text-fg"
        placeholder={"clock,r_frac,dial\n12:00,0.80,-30"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onPickFile(f);
        }}
        style={dropOver ? { outline: "1px dashed #8b8d93" } : undefined}
      />
      <div className="mt-2 flex gap-1">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" />
          File
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={!text.trim()}
          onClick={() => onPaste(text)}
        >
          Load paste
        </Button>
      </div>
    </div>
  );
}

function ExportPanel({ payload, onClose }: { payload: ExportPayload; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!payload.text) return;
    const ok = await copyText(payload.text);
    setCopied(ok);
    toast(ok ? "Copied to clipboard" : "Copy failed — select the text instead");
  }

  function onSave() {
    if (payload.text) {
      const blob = new Blob([payload.text], {
        type: payload.kind === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      });
      const ok = downloadBlob(blob, payload.filename);
      toast(ok ? `Saving ${payload.filename}` : "Download blocked — copy the text instead");
      return;
    }
    if (payload.dataUrl) {
      const blob = dataUrlToBlob(payload.dataUrl);
      if (!blob) {
        toast.error("Could not build the PNG");
        return;
      }
      const ok = downloadBlob(blob, payload.filename);
      toast(ok ? `Saving ${payload.filename}` : "Download blocked — right-click the image and save");
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-surface/95 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Export {payload.kind.toUpperCase()}</h2>
        <Button size="iconSm" variant="ghost" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      {payload.text ? (
        <textarea
          className="min-h-0 flex-1 resize-none rounded-md border border-line bg-bg p-2 font-mono text-2xs text-fg"
          readOnly
          value={payload.text}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : payload.dataUrl ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line bg-bg p-2">
          <img src={payload.dataUrl} alt="Map export" className="mx-auto max-h-full max-w-full" />
        </div>
      ) : null}
      <div className="mt-2 flex gap-1">
        {payload.text ? (
          <Button size="sm" variant="outline" className="flex-1" onClick={() => void onCopy()}>
            <Copy className="size-3.5" />
            {copied ? "Copied" : "Copy"}
          </Button>
        ) : null}
        <Button size="sm" className="flex-1" onClick={onSave}>
          <Download className="size-3.5" />
          Save file
        </Button>
      </div>
    </div>
  );
}

function ParaControls({ para }: { para: ParallelismResult | null }) {
  const job = useJobStore((s) => s.job);
  const points = useJobStore((s) => s.points);
  const faceB = useJobStore((s) => s.faceB);
  const setFaceB = useJobStore((s) => s.setFaceB);
  const importFaceB = useJobStore((s) => s.importFaceB);
  const loadPlatePair = useJobStore((s) => s.loadPlatePair);
  const thicknessMm = useJobStore((s) => s.thicknessMm);
  const setThicknessMm = useJobStore((s) => s.setThicknessMm);
  const paraFlip = useJobStore((s) => s.paraFlip);
  const setParaFlip = useJobStore((s) => s.setParaFlip);
  const paraAuto = useJobStore((s) => s.paraAuto);
  const setParaAuto = useJobStore((s) => s.setParaAuto);
  const paraOffsetHours = useJobStore((s) => s.paraOffsetHours);
  const setParaOffsetHours = useJobStore((s) => s.setParaOffsetHours);
  const showContours = useJobStore((s) => s.showContours);
  const setShowContours = useJobStore((s) => s.setShowContours);
  const showPoints = useJobStore((s) => s.showPoints);
  const setShowPoints = useJobStore((s) => s.setShowPoints);
  const fileRef = useRef<HTMLInputElement>(null);
  const offset = paraAuto ? (para?.offsetHours ?? 0) : paraOffsetHours;

  async function onPickB(file: File) {
    const text = await file.text();
    const n = importFaceB(text);
    if (!n) {
      toast.error("Could not parse that file as a face");
      return;
    }
    toast(`2nd face · ${n} readings`);
  }

  return (
    <>
      {para?.ready ? (
        <Section label="Parallelism">
          <div className="mb-2 h-2 w-full rounded-full" style={{ background: colorBarCss() }} />
          <div className="mb-3 flex justify-between font-mono text-2xs text-muted tabular-nums">
            <span>thin {formatMm(para.thicknessLow)}</span>
            <span>{thicknessMm.toFixed(1)} mm</span>
            <span>thick {formatMm(para.thicknessHigh)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Parallelism" value={`${para.thicknessPv.toFixed(2)} mm`} hint="thickness P–V" />
            <Stat
              label="Match"
              value={`${Math.round(Math.max(0, para.corr) * 100)}%`}
              hint="faces as opposites"
            />
            <Stat
              label="Wedge"
              value={`${para.wedgeMm.toFixed(2)} mm`}
              hint={`${para.wedgeDeg.toFixed(3)}° · ${formatClock(para.wedgeClockHours)} thick`}
            />
            <Stat label="Thickness RMS" value={`${para.rms.toFixed(3)} mm`} />
            <Stat label="1st flatness" value={`${para.flatnessA.toFixed(2)} mm`} />
            <Stat label="2nd flatness" value={`${para.flatnessB.toFixed(2)} mm`} />
          </div>
          <p className="mt-2 text-2xs leading-snug text-dim">
            Thickness range after the clocks are registered. Much smaller than each face’s
            flatness means the plate is warped together, not wedged.
          </p>
        </Section>
      ) : null}

      <Section label="Alignment">
        <Field label="Flip">
          <select
            className="h-8 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg"
            value={paraFlip}
            onChange={(e) => setParaFlip(e.target.value as FlipSetting)}
          >
            <option value="auto">Auto</option>
            <option value="none">Rotate only</option>
            <option value="mirror12">Flip 12–6 (left–right)</option>
            <option value="mirror39">Flip 3–9 (toward you)</option>
          </select>
        </Field>
        {para?.ready ? (
          <>
            <p className="mb-2 font-mono text-xs text-fg tabular-nums">
              {formatCorrespondence(para.clockBAt12)}
            </p>
            <p className="mb-2 text-2xs text-muted">
              {FLIP_LABEL[para.flip]}
              {paraAuto ? " · auto" : " · manual"} · {formatOffsetHours(offset)}
            </p>
            {para.altOffsetHours != null ? (
              <p className="mb-2 text-2xs text-dim">
                Another match 6 hours around ({formatOffsetHours(para.altOffsetHours)})
                — a saddle can clock two ways.
              </p>
            ) : null}
            <Button
              size="sm"
              variant={paraAuto ? "outline" : "default"}
              className="mb-2 w-full"
              onClick={() => {
                if (paraAuto) setParaOffsetHours(para.offsetHours);
                else setParaAuto(true);
              }}
            >
              {paraAuto ? "Hold this clock" : "Find rotation"}
            </Button>
          </>
        ) : (
          <p className="text-2xs text-dim">Load both faces to search the clock offset.</p>
        )}
      </Section>

      <Section label="Faces">
        <div className="space-y-2">
          <FaceRow
            label="1st face"
            name={job.name}
            n={points.length}
            hint="current job"
          />
          <FaceRow
            label="2nd face"
            name={faceB?.job.name ?? "—"}
            n={faceB?.points.length ?? 0}
            hint={faceB ? undefined : "not loaded"}
          />
        </div>
        <div className="mt-2 space-y-1">
          <Button size="sm" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" />
            Import 2nd face
          </Button>
          <div className="grid grid-cols-2 gap-1">
            {PLATE_PAIRS.map((pair) => (
              <Button
                key={pair.id}
                size="sm"
                variant="outline"
                onClick={() => {
                  if (loadPlatePair(pair.id)) toast(`Loaded ${pair.label}`);
                  else toast.error("Could not load that plate pair");
                }}
              >
                {pair.label}
              </Button>
            ))}
          </div>
        </div>
        {faceB ? (
          <button
            type="button"
            className="mt-2 text-2xs text-muted hover:text-fg"
            onClick={() => setFaceB(null)}
          >
            Clear 2nd face
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickB(f);
            e.target.value = "";
          }}
        />
      </Section>

      <Section label="Plate">
        <Field label="Nominal thickness">
          <div className="relative">
            <Input
              type="number"
              value={thicknessMm}
              onChange={(e) => setThicknessMm(Number(e.target.value) || 0)}
            />
            <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-dim">mm</span>
          </div>
        </Field>
        <p className="text-2xs leading-snug text-dim">
          Each face sat on the other, on a surface plate. Near-constant thickness makes the two
          form maps opposites once the clocks match.
        </p>
      </Section>

      <Section label="">
        <ToggleRow label="Contours" checked={showContours} onChange={setShowContours} />
        <ToggleRow label="Point marks" checked={showPoints} onChange={setShowPoints} />
      </Section>
    </>
  );
}

function FaceRow({
  label,
  name,
  n,
  hint,
}: {
  label: string;
  name: string;
  n: number;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div>
        <div className="text-2xs text-dim">{label}</div>
        <div className="truncate text-sm text-fg">{name}</div>
      </div>
      <div className="shrink-0 text-right font-mono text-2xs text-muted tabular-nums">
        {n} pts
        {hint ? <div className="text-dim">{hint}</div> : null}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      {label ? (
        <h2 className="mb-2 text-2xs font-medium tracking-widest text-dim uppercase">{label}</h2>
      ) : null}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-2xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "high" | "low";
}) {
  return (
    <div>
      <div className="text-2xs text-dim">{label}</div>
      <div
        className={cn(
          "font-mono text-sm font-medium tabular-nums",
          accent === "high" && "text-high",
          accent === "low" && "text-low",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-2xs text-muted">{hint}</div> : null}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex h-8 items-center justify-between gap-3">
      <span className="text-sm text-fg">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  v,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  v: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-fg tabular-nums">{value}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[v]} onValueChange={(a) => onChange(a[0] ?? v)} />
    </div>
  );
}


