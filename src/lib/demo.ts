import type { FaceSlot, Job, PhotoFit, Reading } from "./types";
import { parseJobText } from "./csv";
import sampleCsv from "./sample-plate.csv?raw";
import face1Csv from "./faces/1st-face.csv?raw";
import face2Csv from "./faces/2nd-face.csv?raw";
import face1NewCsv from "./faces/1st-new.csv?raw";
import face2NewCsv from "./faces/2st-new.csv?raw";

export const DEMO_PHOTO = "/photo.png";

const parsed = parseJobText(sampleCsv);

export function generateDemoReadings(): Reading[] {
  const pts = parsed?.points ?? [];
  return pts.map((p, i) => ({ ...p, id: `d${i}` }));
}

export function demoJob(): Job {
  return parsed?.job ?? { name: "New face", odMm: 435, idMm: 0, dialUnitMm: 0.01 };
}

export function demoPhoto(): PhotoFit {
  return {
    src: DEMO_PHOTO,
    scale: 1,
    panX: 0.02,
    panY: 0,
    rotationDeg: 0,
  };
}

/** Previous default zoom clipped 12 and 6 on photo.png. */
export function isStaleDemoPhotoFit(photo: PhotoFit): boolean {
  return (
    photo.src === DEMO_PHOTO &&
    Math.abs(photo.scale - 1.12) < 0.005 &&
    Math.abs(photo.panX - 0.04) < 0.005 &&
    Math.abs(photo.panY - 0.04) < 0.005
  );
}

export function isCustomPhoto(photo: PhotoFit): boolean {
  const src = photo.src;
  if (!src) return false;
  if (src === DEMO_PHOTO || src === "/demo-flange.jpg") return false;
  if (src.startsWith("/") && !src.startsWith("/idb")) return false;
  return true;
}

export const SAMPLE_CSV = sampleCsv;
export const FACE_A_CSV = face1Csv;
export const FACE_B_CSV = face2Csv;

export type PlatePairId = "original" | "new";

export const PLATE_PAIRS: {
  id: PlatePairId;
  label: string;
  aName: string;
  bName: string;
}[] = [
  { id: "original", label: "1st & 2nd face", aName: "1st face", bName: "2nd face" },
  { id: "new", label: "1st-new & 2st-new", aName: "1st new", bName: "2nd new" },
];

const PAIR_CSV: Record<PlatePairId, { a: string; b: string }> = {
  original: { a: face1Csv, b: face2Csv },
  new: { a: face1NewCsv, b: face2NewCsv },
};

export function platePair(id: PlatePairId = "original"): { a: FaceSlot; b: FaceSlot } | null {
  const spec = PLATE_PAIRS.find((p) => p.id === id);
  const csv = PAIR_CSV[id];
  if (!spec || !csv) return null;
  const a = parseJobText(csv.a);
  const b = parseJobText(csv.b);
  if (!a || !b || a.points.length < 3 || b.points.length < 3) return null;
  return {
    a: { job: { ...a.job, name: spec.aName }, points: a.points },
    b: { job: { ...b.job, name: spec.bName }, points: b.points },
  };
}
