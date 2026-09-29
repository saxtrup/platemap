export type Reading = {
  id: string;
  /** Hours past 12 o'clock, in [0, 12). 0 = 12:00, 3 = 3:00. */
  clockHours: number;
  /** 0 at centre, 1 at outside diameter. */
  rFrac: number;
  /** Dial indicator reading in divisions. */
  dial: number;
};

export type Job = {
  name: string;
  odMm: number;
  /** Bore / inner diameter. 0 = solid disc. */
  idMm: number;
  dialUnitMm: number;
};

export type PhotoFit = {
  src: string | null;
  /** 1 = photo diameter matches the face circle. */
  scale: number;
  /** Pan as a fraction of the face radius. */
  panX: number;
  panY: number;
  rotationDeg: number;
};

export type ViewMode = "map" | "photo" | "3d" | "cut" | "para";

/** How the 2nd-face clock is folded onto the 1st-face clock. */
export type FlipKind = "none" | "mirror12" | "mirror39";
export type FlipSetting = FlipKind | "auto";

export type FaceSlot = {
  job: Job;
  points: Reading[];
};

export type Draft = {
  id: string | null;
  clockHours: number;
  rFrac: number;
  dial: string;
};

export type JobSnapshot = {
  job: Job;
  points: Reading[];
  photo: PhotoFit;
};

export const DIAL_UNITS: { label: string; value: number }[] = [
  { label: "0.01 mm", value: 0.01 },
  { label: "0.001 mm", value: 0.001 },
  { label: "0.002 mm", value: 0.002 },
  { label: "0.005 mm", value: 0.005 },
  { label: "0.0001 in", value: 0.00254 },
  { label: "0.0005 in", value: 0.0127 },
  { label: "0.001 in", value: 0.0254 },
];

export function idFracOf(job: { odMm: number; idMm: number }): number {
  if (!(job.odMm > 0) || !(job.idMm > 0)) return 0;
  return Math.max(0, Math.min(0.92, job.idMm / job.odMm));
}
