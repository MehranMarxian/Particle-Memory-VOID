/**
 * The screensaver camera, as data.
 *
 * The idle camera was three constants inline in the frame loop: a slow orbit,
 * a long dolly breath, and a vertical breathe on top of the user's
 * elevation. As data it becomes the extension of the idle/ghost system the
 * presets needed: a screensaver preset is a look plus a camera, and a preset
 * that ships no camera gets exactly today's motion back.
 *
 * Three paths:
 *   orbit    - the authored slow turn (today's behaviour).
 *   figure8  - the same turn with a sinusoidal azimuth weave: the camera
 *              loops in petals around the subject without ever crossing it.
 *   recorded - the orbit leans toward the recorded hand the ghost replays;
 *              the camera remembers where the hand went.
 *
 * In the editor the user owns the radius and the slow orbit stays at its own
 * constant; the choreography governs the screensaver, with the breathe on
 * both (as it always was).
 */

export type CameraPath = "orbit" | "figure8" | "recorded";

export interface CameraChoreography {
  path: CameraPath;
  /** Azimuth rate in the screensaver, radians per second. */
  orbitSpeed: number;
  orbitDirection: 1 | -1;
  /** The dolly breath: radius oscillates between base - amplitude and base + amplitude. */
  zoomBase: number;
  zoomAmplitude: number;
  zoomPeriodSeconds: number;
  /** The "held breath": elevation oscillation on top of the user's elevation. */
  elevationWander: number;
  /** Elevation breathe rate, radians per second (today 0.12: a ~52 s cycle). */
  breatheRate: number;
  /** Azimuth weave amplitude for the figure8 path, radians. */
  figureWeave: number;
}

/** Today's motion, exactly: the constants the frame loop hardcoded. */
export const DEFAULT_CAMERA_CHOREOGRAPHY: CameraChoreography = {
  path: "orbit",
  orbitSpeed: 0.035,
  orbitDirection: 1,
  zoomBase: 15.5,
  zoomAmplitude: 4.5,
  zoomPeriodSeconds: 25,
  elevationWander: 0.05,
  breatheRate: 0.12,
  figureWeave: 0.9,
};

const CAMERA_PATHS: readonly CameraPath[] = ["orbit", "figure8", "recorded"];

/** Force a choreography (persisted state, hostile presets) back into range. */
export function clampCameraChoreography(c: Partial<CameraChoreography>): CameraChoreography {
  const cl = (v: number | undefined, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const d = c.orbitDirection;
  return {
    path: c.path && CAMERA_PATHS.includes(c.path) ? c.path : "orbit",
    orbitSpeed: cl(c.orbitSpeed, 0, 0.2, DEFAULT_CAMERA_CHOREOGRAPHY.orbitSpeed),
    orbitDirection: d === -1 ? -1 : 1,
    zoomBase: cl(c.zoomBase, 5, 40, DEFAULT_CAMERA_CHOREOGRAPHY.zoomBase),
    zoomAmplitude: cl(c.zoomAmplitude, 0, 15, DEFAULT_CAMERA_CHOREOGRAPHY.zoomAmplitude),
    zoomPeriodSeconds: cl(c.zoomPeriodSeconds, 5, 600, DEFAULT_CAMERA_CHOREOGRAPHY.zoomPeriodSeconds),
    elevationWander: cl(c.elevationWander, 0, 0.5, DEFAULT_CAMERA_CHOREOGRAPHY.elevationWander),
    breatheRate: cl(c.breatheRate, 0, 2, DEFAULT_CAMERA_CHOREOGRAPHY.breatheRate),
    figureWeave: cl(c.figureWeave, 0, 3, DEFAULT_CAMERA_CHOREOGRAPHY.figureWeave),
  };
}

/** The dolly breath: the radius the screensaver holds at time `tSec`. */
export function dollyRadius(c: CameraChoreography, tSec: number): number {
  return c.zoomBase + c.zoomAmplitude * Math.sin((tSec * Math.PI * 2) / Math.max(0.1, c.zoomPeriodSeconds));
}

/** The held breath: the elevation offset at time `tSec` (editor and screensaver). */
export function breatheOffset(c: CameraChoreography, tSec: number): number {
  return Math.sin(tSec * c.breatheRate) * c.elevationWander;
}

/**
 * The camera pose for the screensaver at time `tSec`, given the accumulated
 * azimuth and the user's elevation. `pointer` is the ghost hand's NDC when
 * one is playing; the recorded path leans the camera toward it.
 */
export function cameraPose(
  c: CameraChoreography,
  tSec: number,
  baseAzimuth: number,
  baseElevation: number,
  pointer?: { x: number; y: number } | null
): { azimuth: number; elevation: number; radius: number } {
  let azimuth = baseAzimuth;
  let elevation = baseElevation + breatheOffset(c, tSec);
  if (c.path === "figure8") {
    azimuth += Math.sin(tSec * c.orbitSpeed * 2) * c.figureWeave;
  }
  if (c.path === "recorded" && pointer) {
    azimuth += pointer.x * 0.5;
    elevation += pointer.y * 0.3;
  }
  return { azimuth, elevation, radius: dollyRadius(c, tSec) };
}
