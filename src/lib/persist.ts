import type { FaceSlot, FlipSetting, Job, PhotoFit, Reading, ViewMode } from "./types";
import { demoPhoto, isStaleDemoPhotoFit } from "./demo";

export const LS_KEY = "platemap-v6";
const LS_LEGACY = ["platemap-v5", "platemap-v3", "platemap-v2"] as const;
const IDB_NAME = "platemap";
const IDB_STORE = "kv";
const IDB_SNAPSHOT = "snapshot-v6";
const IDB_PHOTO = "photo-blob-v6";
export const PHOTO_IDB_SRC = "idb:blob";
const DEMO_PHOTO_SRC = "/photo.png";
const LEGACY_DEMO_PHOTO = "/demo-flange.jpg";

export type PersistedSnapshot = {
  v: 5;
  job: Job;
  points: Reading[];
  photo: PhotoFit;
  view: ViewMode;
  subtractPlane: boolean;
  showContours: boolean;
  showPoints: boolean;
  contourStep: number;
  wash: number;
  cutClockHours: number;
  savedAt: number;
  faceB?: FaceSlot | null;
  thicknessMm?: number;
  paraOffsetHours?: number;
  paraAuto?: boolean;
  paraFlip?: FlipSetting;
};

function isPhotoFit(p: unknown): p is PhotoFit {
  if (!p || typeof p !== "object") return false;
  const o = p as PhotoFit;
  return typeof o.scale === "number";
}

export function sanitizePoints(raw: unknown): Reading[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Reading[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const clock = Number(o.clockHours);
    const rFrac = Number(o.rFrac);
    const dial = Number(o.dial);
    if (![clock, rFrac, dial].every(Number.isFinite)) continue;
    const id = typeof o.id === "string" && o.id ? o.id : `p${out.length}`;
    out.push({
      id,
      clockHours: ((clock % 12) + 12) % 12,
      rFrac: Math.max(0, Math.min(1.05, rFrac)),
      dial,
    });
  }
  return out;
}

export function sanitizeJob(raw: unknown, fallback: Job): Job {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const odMm = Number(o.odMm);
  const idMm = Number(o.idMm);
  const dialUnitMm = Number(o.dialUnitMm);
  return {
    name: typeof o.name === "string" && o.name.trim() ? o.name : fallback.name,
    odMm: Number.isFinite(odMm) && odMm > 0 ? odMm : fallback.odMm,
    idMm: Number.isFinite(idMm) && idMm >= 0 ? idMm : 0,
    dialUnitMm: Number.isFinite(dialUnitMm) && dialUnitMm > 0 ? dialUnitMm : fallback.dialUnitMm,
  };
}

export function sanitizeSnapshot(raw: unknown, fallbackJob: Job): PersistedSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const points = sanitizePoints(o.points);
  if (!points) return null;
  const photo: PhotoFit = isPhotoFit(o.photo)
    ? {
        src: typeof o.photo.src === "string" ? o.photo.src : null,
        scale: Number.isFinite(o.photo.scale) ? o.photo.scale : 1,
        panX: Number.isFinite(o.photo.panX) ? o.photo.panX : 0,
        panY: Number.isFinite(o.photo.panY) ? o.photo.panY : 0,
        rotationDeg: Number.isFinite(o.photo.rotationDeg) ? o.photo.rotationDeg : 0,
      }
    : { src: null, scale: 1, panX: 0, panY: 0, rotationDeg: 0 };
  if (photo.src && (photo.src.startsWith("blob:") || photo.src.length < 8)) {
    photo.src = null;
  }
  if (photo.src === LEGACY_DEMO_PHOTO) {
    photo.src = DEMO_PHOTO_SRC;
  }
  if (isStaleDemoPhotoFit(photo) || (photo.src === DEMO_PHOTO_SRC && Math.abs(photo.scale - 1.12) < 0.005)) {
    const next = demoPhoto();
    photo.scale = next.scale;
    photo.panX = next.panX;
    photo.panY = next.panY;
  }
  const view = o.view;
  const faceB = sanitizeFaceSlot(o.faceB, fallbackJob);
  const paraFlip = sanitizeFlip(o.paraFlip);
  return {
    v: 5,
    job: sanitizeJob(o.job, fallbackJob),
    points,
    photo,
    view:
      view === "photo" || view === "3d" || view === "cut" || view === "map" || view === "para"
        ? view
        : "map",
    subtractPlane: o.subtractPlane !== false,
    showContours: o.showContours !== false,
    showPoints: o.showPoints !== false,
    contourStep: Number(o.contourStep) > 0 ? Number(o.contourStep) : 0.05,
    wash: Number.isFinite(Number(o.wash)) ? Number(o.wash) : 22,
    cutClockHours: Number.isFinite(Number(o.cutClockHours)) ? Number(o.cutClockHours) : 0,
    savedAt: Number(o.savedAt) || Date.now(),
    faceB,
    thicknessMm: Number(o.thicknessMm) > 0 ? Number(o.thicknessMm) : 25,
    paraOffsetHours: Number.isFinite(Number(o.paraOffsetHours)) ? Number(o.paraOffsetHours) : 0,
    paraAuto: o.paraAuto !== false,
    paraFlip,
  };
}

function sanitizeFaceSlot(raw: unknown, fallbackJob: Job): FaceSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const points = sanitizePoints(o.points);
  if (!points || points.length === 0) return null;
  return { job: sanitizeJob(o.job, fallbackJob), points };
}

function sanitizeFlip(raw: unknown): FlipSetting {
  if (raw === "none" || raw === "mirror12" || raw === "mirror39" || raw === "auto") return raw;
  return "auto";
}

function compactForLocalStorage(snap: PersistedSnapshot): PersistedSnapshot {
  const src = snap.photo.src;
  if (src && src.startsWith("data:") && src.length > 120_000) {
    return { ...snap, photo: { ...snap.photo, src: PHOTO_IDB_SRC } };
  }
  if (src && src.startsWith("blob:")) {
    return { ...snap, photo: { ...snap.photo, src: PHOTO_IDB_SRC } };
  }
  return snap;
}

function migrateLegacyPhoto(snap: PersistedSnapshot, fromLegacy: boolean): PersistedSnapshot {
  if (!fromLegacy) return snap;
  if (!snap.photo.src || snap.photo.src === LEGACY_DEMO_PHOTO) {
    return {
      ...snap,
      photo: { ...demoPhoto(), src: DEMO_PHOTO_SRC },
    };
  }
  return snap;
}

export function loadLocal(fallbackJob: Job): PersistedSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return sanitizeSnapshot(JSON.parse(raw), fallbackJob);
    for (const legacy of LS_LEGACY) {
      const old = localStorage.getItem(legacy);
      if (!old) continue;
      const snap = sanitizeSnapshot(JSON.parse(old), fallbackJob);
      if (snap) return migrateLegacyPhoto(snap, true);
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocal(snap: PersistedSnapshot): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(compactForLocalStorage(snap)));
    return true;
  } catch {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ ...compactForLocalStorage(snap), photo: { ...snap.photo, src: null } }));
      return true;
    } catch {
      return false;
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no idb"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

let liveBlobUrl: string | null = null;

export function adoptObjectUrl(url: string | null): string | null {
  if (liveBlobUrl && liveBlobUrl !== url) {
    try {
      URL.revokeObjectURL(liveBlobUrl);
    } catch {
      /* already revoked */
    }
  }
  liveBlobUrl = url && url.startsWith("blob:") ? url : null;
  return url;
}

export function photoSrcFromFile(file: File): string {
  void idbPut(IDB_PHOTO, file);
  return adoptObjectUrl(URL.createObjectURL(file)) ?? URL.createObjectURL(file);
}

function isPublicPhotoSrc(src: string): boolean {
  return src.startsWith("/") || src.startsWith("http://") || src.startsWith("https://");
}

async function idbPut(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).put(value, key);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openDb();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function existingPhotoBlob(): Promise<Blob | null> {
  try {
    const blob = await idbGet(IDB_PHOTO);
    return blob instanceof Blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

async function persistPhotoSrc(src: string | null): Promise<string | null> {
  if (!src) {
    adoptObjectUrl(null);
    await idbPut(IDB_PHOTO, null);
    return null;
  }
  if (src === PHOTO_IDB_SRC || src.startsWith("idb:")) return PHOTO_IDB_SRC;
  if (isPublicPhotoSrc(src) && !src.startsWith("blob:")) {
    return src;
  }
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error("photo fetch");
    const blob = await res.blob();
    if (!(blob.size > 0)) throw new Error("empty photo");
    const ok = await idbPut(IDB_PHOTO, blob);
    if (ok) return PHOTO_IDB_SRC;
    if (src.startsWith("data:") && src.length < 120_000) return src;
    return (await existingPhotoBlob()) ? PHOTO_IDB_SRC : src.startsWith("data:") && src.length < 120_000 ? src : PHOTO_IDB_SRC;
  } catch {
    if (await existingPhotoBlob()) return PHOTO_IDB_SRC;
    if (src.startsWith("data:") && src.length < 120_000) return src;
    return PHOTO_IDB_SRC;
  }
}

export async function resolvePhotoSrc(src: string | null): Promise<string | null> {
  if (!src) return null;
  if (src === PHOTO_IDB_SRC || src.startsWith("idb:")) {
    try {
      const blob = await idbGet(IDB_PHOTO);
      if (blob instanceof Blob && blob.size > 0) {
        return adoptObjectUrl(URL.createObjectURL(blob));
      }
    } catch {
      return null;
    }
    return null;
  }
  if (src.startsWith("blob:")) return null;
  if (src === LEGACY_DEMO_PHOTO) return DEMO_PHOTO_SRC;
  return src;
}

/** Ordered sources to try on screen. Never returns the `idb:blob` marker. */
export async function displayPhotoCandidates(src: string | null): Promise<string[]> {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !out.includes(s)) out.push(s);
  };
  if (src === PHOTO_IDB_SRC || src?.startsWith("idb:")) {
    add(await resolvePhotoSrc(src));
  } else if (src?.startsWith("blob:")) {
    add(src);
  } else if (src) {
    add(src === LEGACY_DEMO_PHOTO ? DEMO_PHOTO_SRC : src);
  }
  add(DEMO_PHOTO_SRC);
  add("/demo-flange.jpg");
  return out;
}

export async function saveIdb(snap: PersistedSnapshot): Promise<boolean> {
  return idbPut(IDB_SNAPSHOT, snap);
}

export async function loadIdb(fallbackJob: Job): Promise<PersistedSnapshot | null> {
  try {
    const raw = await idbGet(IDB_SNAPSHOT);
    return sanitizeSnapshot(raw, fallbackJob);
  } catch {
    return null;
  }
}

export async function persistSnapshot(snap: PersistedSnapshot): Promise<boolean> {
  const src = await persistPhotoSrc(snap.photo.src);
  const compact: PersistedSnapshot = { ...snap, photo: { ...snap.photo, src } };
  const ls = saveLocal(compact);
  const idb = await saveIdb(compact);
  return ls || idb;
}

export async function restoreSnapshot(fallbackJob: Job): Promise<PersistedSnapshot | null> {
  const ls = loadLocal(fallbackJob);
  const idb = await loadIdb(fallbackJob);
  let merged: PersistedSnapshot | null = null;
  if (idb && ls) {
    const photo =
      idb.photo.src && !ls.photo.src
        ? idb.photo
        : ls.photo.src
          ? ls.photo
          : idb.photo;
    const newer = (idb.savedAt || 0) >= (ls.savedAt || 0) ? idb : ls;
    merged = { ...newer, photo, points: newer.points };
  } else {
    merged = idb ?? ls;
  }
  if (!merged) return null;
  const src = await resolvePhotoSrc(merged.photo.src);
  return { ...merged, photo: { ...merged.photo, src } };
}
