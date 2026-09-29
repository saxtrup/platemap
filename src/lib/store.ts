import { create } from "zustand";
import type { Draft, FaceSlot, FlipSetting, Job, PhotoFit, Reading, ViewMode } from "./types";
import {
  DEMO_PHOTO,
  demoJob,
  demoPhoto,
  generateDemoReadings,
  isCustomPhoto,
  isStaleDemoPhotoFit,
  platePair,
  type PlatePairId,
} from "./demo";
import { parseJobText } from "./csv";
import {
  persistSnapshot,
  restoreSnapshot,
  loadLocal,
  PHOTO_IDB_SRC,
  type PersistedSnapshot,
} from "./persist";
import { uid } from "./utils";

export type JobState = {
  job: Job;
  points: Reading[];
  photo: PhotoFit;
  view: ViewMode;
  subtractPlane: boolean;
  showContours: boolean;
  showPoints: boolean;
  contourStep: number;
  wash: number;
  selectedId: string | null;
  draft: Draft | null;
  cutClockHours: number;
  photoAdjust: boolean;
  savedAt: number | null;
  saveState: "idle" | "saving" | "saved" | "error";
  hydrated: boolean;
  faceB: FaceSlot | null;
  thicknessMm: number;
  paraOffsetHours: number;
  paraAuto: boolean;
  paraFlip: FlipSetting;
  setJob: (patch: Partial<Job>) => void;
  setView: (view: ViewMode) => void;
  setSubtractPlane: (v: boolean) => void;
  setShowContours: (v: boolean) => void;
  setShowPoints: (v: boolean) => void;
  setContourStep: (v: number) => void;
  setWash: (v: number) => void;
  setCutClock: (v: number) => void;
  setPhoto: (patch: Partial<PhotoFit>) => void;
  setPhotoAdjust: (v: boolean) => void;
  select: (id: string | null) => void;
  startDraft: (clockHours: number, rFrac: number, id?: string | null) => void;
  updateDraft: (patch: Partial<Draft>) => void;
  commitDraft: () => void;
  cancelDraft: () => void;
  updatePoint: (id: string, patch: Partial<Reading>) => void;
  removePoint: (id: string) => void;
  clearPoints: () => void;
  loadDemo: () => void;
  resetJob: () => void;
  replacePoints: (points: Reading[], job?: Partial<Job>) => void;
  importText: (text: string) => number;
  hydrate: () => void;
  setFaceB: (slot: FaceSlot | null) => void;
  importFaceB: (text: string) => number;
  loadPlatePair: (id?: PlatePairId) => boolean;
  setThicknessMm: (v: number) => void;
  setParaOffsetHours: (v: number) => void;
  setParaAuto: (v: boolean) => void;
  setParaFlip: (v: FlipSetting) => void;
};

const demoPoints = generateDemoReadings();

function toSnap(s: JobState): PersistedSnapshot {
  return {
    v: 5,
    job: s.job,
    points: s.points,
    photo: s.photo,
    view: s.view,
    subtractPlane: s.subtractPlane,
    showContours: s.showContours,
    showPoints: s.showPoints,
    contourStep: s.contourStep,
    wash: s.wash,
    cutClockHours: s.cutClockHours,
    savedAt: Date.now(),
    faceB: s.faceB,
    thicknessMm: s.thicknessMm,
    paraOffsetHours: s.paraOffsetHours,
    paraAuto: s.paraAuto,
    paraFlip: s.paraFlip,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

function schedulePersist(get: () => JobState, set: (p: Partial<JobState>) => void) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistChain = persistChain.then(async () => {
      const s = get();
      if (!s.hydrated) return;
      const snap = toSnap(s);
      set({ saveState: "saving" });
      const ok = await persistSnapshot(snap);
      const latest = get();
      if (latest.points !== s.points || latest.job !== s.job || latest.photo !== s.photo) return;
      set({ saveState: ok ? "saved" : "error", savedAt: ok ? snap.savedAt : latest.savedAt });
    });
  }, 180);
}

function applySnap(snap: PersistedSnapshot): Partial<JobState> {
  return {
    job: snap.job,
    points: snap.points,
    photo: snap.photo,
    view: snap.view,
    subtractPlane: snap.subtractPlane,
    showContours: snap.showContours,
    showPoints: snap.showPoints,
    contourStep: snap.contourStep,
    wash: snap.wash,
    cutClockHours: snap.cutClockHours,
    savedAt: snap.savedAt,
    saveState: "saved",
    selectedId: null,
    draft: null,
    faceB: snap.faceB ?? null,
    thicknessMm: snap.thicknessMm ?? 25,
    paraOffsetHours: snap.paraOffsetHours ?? 0,
    paraAuto: snap.paraAuto !== false,
    paraFlip: snap.paraFlip ?? "auto",
  };
}

export const useJobStore = create<JobState>((set, get) => ({
  job: demoJob(),
  points: demoPoints,
  photo: demoPhoto(),
  view: "map",
  subtractPlane: true,
  showContours: true,
  showPoints: true,
  contourStep: 0.05,
  wash: 22,
  selectedId: null,
  draft: null,
  cutClockHours: 1 + 53 / 60,
  photoAdjust: false,
  savedAt: null,
  saveState: "idle",
  hydrated: false,
  faceB: null,
  thicknessMm: 25,
  paraOffsetHours: 0,
  paraAuto: true,
  paraFlip: "auto",
  setJob: (patch) => set((s) => ({ job: { ...s.job, ...patch } })),
  setView: (view) => set({ view, photoAdjust: view === "photo" ? get().photoAdjust : false }),
  setSubtractPlane: (subtractPlane) => set({ subtractPlane }),
  setShowContours: (showContours) => set({ showContours }),
  setShowPoints: (showPoints) => set({ showPoints }),
  setContourStep: (contourStep) => set({ contourStep }),
  setWash: (wash) => set({ wash }),
  setCutClock: (cutClockHours) => set({ cutClockHours }),
  setPhoto: (patch) => set((s) => ({ photo: { ...s.photo, ...patch } })),
  setPhotoAdjust: (photoAdjust) => set({ photoAdjust }),
  select: (selectedId) => set({ selectedId, draft: null }),
  startDraft: (clockHours, rFrac, id = null) => {
    const existing = id ? get().points.find((p) => p.id === id) : undefined;
    set({
      selectedId: id,
      draft: {
        id,
        clockHours,
        rFrac,
        dial: existing ? String(existing.dial) : "",
      },
    });
  },
  updateDraft: (patch) =>
    set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),
  commitDraft: () => {
    const { draft, points } = get();
    if (!draft) return;
    const dial = Number(String(draft.dial).replace(",", "."));
    if (!Number.isFinite(dial)) return;
    if (draft.id) {
      set({
        points: points.map((p) =>
          p.id === draft.id
            ? { ...p, clockHours: draft.clockHours, rFrac: draft.rFrac, dial }
            : p,
        ),
        draft: null,
        selectedId: draft.id,
      });
      return;
    }
    const reading: Reading = {
      id: uid(),
      clockHours: draft.clockHours,
      rFrac: draft.rFrac,
      dial,
    };
    set({ points: [...points, reading], draft: null, selectedId: reading.id });
  },
  cancelDraft: () => set({ draft: null }),
  updatePoint: (id, patch) =>
    set((s) => ({
      points: s.points.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  removePoint: (id) =>
    set((s) => ({
      points: s.points.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      draft: s.draft?.id === id ? null : s.draft,
    })),
  clearPoints: () => set({ points: [], selectedId: null, draft: null }),
  loadDemo: () =>
    set((s) => ({
      job: demoJob(),
      points: generateDemoReadings(),
      photo: isCustomPhoto(s.photo) ? s.photo : demoPhoto(),
      selectedId: null,
      draft: null,
      subtractPlane: true,
      showContours: true,
      showPoints: true,
      wash: 22,
      contourStep: 0.05,
      view: "map",
      faceB: null,
    })),
  resetJob: () =>
    set({
      job: { name: "New face", odMm: 435, idMm: 0, dialUnitMm: 0.01 },
      points: [],
      photo: { src: null, scale: 1, panX: 0, panY: 0, rotationDeg: 0 },
      selectedId: null,
      draft: null,
      view: "map",
      faceB: null,
    }),
  replacePoints: (points, job) =>
    set((s) => ({
      points,
      job: job ? { ...s.job, ...job } : s.job,
      selectedId: null,
      draft: null,
      view: "map",
    })),
  importText: (text) => {
    const parsed = parseJobText(text);
    if (!parsed || parsed.points.length === 0) return 0;
    set((s) => ({
      points: parsed.points,
      job: { ...s.job, ...parsed.job },
      selectedId: null,
      draft: null,
      view: "map" as const,
    }));
    return parsed.points.length;
  },
  setFaceB: (faceB) => set({ faceB }),
  importFaceB: (text) => {
    const parsed = parseJobText(text);
    if (!parsed || parsed.points.length === 0) return 0;
    set({ faceB: { job: parsed.job, points: parsed.points }, paraAuto: true });
    return parsed.points.length;
  },
  loadPlatePair: (id = "original") => {
    const pair = platePair(id);
    if (!pair) return false;
    set({
      job: pair.a.job,
      points: pair.a.points,
      faceB: pair.b,
      selectedId: null,
      draft: null,
      view: "para",
      paraAuto: true,
      paraFlip: "auto",
      thicknessMm: 25,
    });
    return true;
  },
  setThicknessMm: (thicknessMm) => set({ thicknessMm: Math.max(0.1, thicknessMm) }),
  setParaOffsetHours: (paraOffsetHours) =>
    set({ paraOffsetHours: ((paraOffsetHours % 12) + 12) % 12, paraAuto: false }),
  setParaAuto: (paraAuto) => set({ paraAuto }),
  setParaFlip: (paraFlip) => set({ paraFlip, paraAuto: true }),
  hydrate: () => {
    if (get().hydrated) return;
    const fallback = get().job;
    const ls = loadLocal(fallback);
    if (ls) {
      const applied = applySnap(ls);
      const src = ls.photo.src;
      if (!src || src === PHOTO_IDB_SRC || src.startsWith("idb:") || src.startsWith("data:")) {
        applied.photo = get().photo;
      }
      set(applied);
    }
    const pointsAtStart = get().points;
    const restore = restoreSnapshot(fallback);
    const timeout = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), 8000);
    });
    void Promise.race([restore, timeout]).then((snap) => {
      const s = get();
      if (s.hydrated) return;
      if (snap) {
        const next = applySnap(snap);
        if (!snap.photo.src && s.photo.src) next.photo = s.photo;
        if (s.points === pointsAtStart) set(next);
        else if (snap.photo.src) set({ photo: snap.photo });
      }
      set({ hydrated: true });
    });
  },
}));

if (typeof window !== "undefined") {
  const now = useJobStore.getState();
  if (isStaleDemoPhotoFit(now.photo) || (now.photo.src === DEMO_PHOTO && Math.abs(now.photo.scale - 1.12) < 0.005)) {
    useJobStore.setState({ photo: { ...now.photo, ...demoPhoto() } });
  }
  useJobStore.subscribe((s, prev) => {
    if (!s.hydrated) return;
    const changed =
      s.job !== prev.job ||
      s.points !== prev.points ||
      s.photo !== prev.photo ||
      s.view !== prev.view ||
      s.subtractPlane !== prev.subtractPlane ||
      s.showContours !== prev.showContours ||
      s.showPoints !== prev.showPoints ||
      s.contourStep !== prev.contourStep ||
      s.wash !== prev.wash ||
      s.cutClockHours !== prev.cutClockHours ||
      s.faceB !== prev.faceB ||
      s.thicknessMm !== prev.thicknessMm ||
      s.paraOffsetHours !== prev.paraOffsetHours ||
      s.paraAuto !== prev.paraAuto ||
      s.paraFlip !== prev.paraFlip;
    if (!changed) return;
    schedulePersist(useJobStore.getState, (p) => useJobStore.setState(p));
  });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    const s = useJobStore.getState();
    if (s.hydrated) void persistSnapshot(toSnap(s));
  });
  window.addEventListener("pagehide", () => {
    const s = useJobStore.getState();
    if (s.hydrated) void persistSnapshot(toSnap(s));
  });
}
