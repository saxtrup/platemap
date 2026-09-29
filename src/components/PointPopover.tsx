import { useEffect, useRef } from "react";
import { formatClock, formatMm } from "@/lib/geometry";
import { useJobStore } from "@/lib/store";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function PointPopover({
  x,
  y,
  wrapW,
  wrapH,
}: {
  x: number;
  y: number;
  wrapW: number;
  wrapH: number;
}) {
  const draft = useJobStore((s) => s.draft);
  const job = useJobStore((s) => s.job);
  const updateDraft = useJobStore((s) => s.updateDraft);
  const commitDraft = useJobStore((s) => s.commitDraft);
  const cancelDraft = useJobStore((s) => s.cancelDraft);
  const removePoint = useJobStore((s) => s.removePoint);
  const inputRef = useRef<HTMLInputElement>(null);

  const draftKey = draft
    ? `${draft.id ?? "new"}:${draft.clockHours.toFixed(4)}:${draft.rFrac.toFixed(4)}`
    : "";

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    const focus = () => {
      if (cancelled) return;
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (el.value) el.select();
    };
    const raf = requestAnimationFrame(() => {
      focus();
      requestAnimationFrame(focus);
    });
    const t = window.setTimeout(focus, 40);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [draftKey]);

  if (!draft) return null;

  const left = Math.min(wrapW - 196, Math.max(8, x + 14));
  const top = Math.min(wrapH - 168, Math.max(8, y - 20));
  const mm = Number(String(draft.dial).replace(",", "."));
  const mmText = Number.isFinite(mm) ? formatMm(mm * job.dialUnitMm) : "—";

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelDraft();
    } else if ((e.key === "Backspace" || e.key === "Delete") && draft?.id && draft.dial === "") {
      removePoint(draft.id);
    }
  }

  return (
    <div
      className="absolute z-20 w-44 rounded-lg border border-line bg-surface p-2.5 shadow-xl"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKey}
    >
      <div className="mb-2 flex items-baseline justify-between font-mono text-xs text-muted tabular-nums">
        <span>{formatClock(draft.clockHours)}</span>
        <span>{Math.round(draft.rFrac * 100)}%</span>
      </div>
      <label className="mb-1 block text-2xs font-medium tracking-wide text-dim uppercase">
        Dial
      </label>
      <Input
        key={draftKey}
        ref={inputRef}
        value={draft.dial}
        autoFocus
        onChange={(e) => updateDraft({ dial: e.target.value })}
        inputMode="decimal"
        aria-label="Dial reading"
        placeholder="-30"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="mt-1 mb-2 font-mono text-xs text-muted tabular-nums">{mmText} mm</div>
      <div className="flex gap-1">
        <Button size="sm" className="flex-1" onClick={commitDraft} disabled={!Number.isFinite(mm)}>
          {draft.id ? "Save" : "Add"}
        </Button>
        {draft.id ? (
          <Button size="sm" variant="outline" onClick={() => removePoint(draft.id!)}>
            Del
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={cancelDraft}>
            Esc
          </Button>
        )}
      </div>
    </div>
  );
}
