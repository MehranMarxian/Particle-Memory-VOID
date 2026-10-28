/**
 * How a 4D clip is played (4D memory, stage 2). One small object, shared by
 * the clip runtime (a lazy chunk), the panel's CLIP section and the keys, so
 * it lives in the eager bundle and the heavy part does not.
 *
 * It is the visitor's, like the layout: kept in localStorage, not in a look.
 */

/** NOW: the present. ECHO: each particle a moment late. SCULPT, SLIT: the whole clip at once. */
export type ClipView = "now" | "echo" | "sculpt" | "slit";
export type ClipLoop = "loop" | "pingpong" | "hold";
/** TRACKED: the same body point every frame. RENEWED: drawn anew every frame. */
export type ClipIdentity = "tracked" | "renewed";
/** What sets how late a particle is, in ECHO. */
export type EchoBy = "gradient" | "random" | "species" | "heat";

export const CLIP_VIEWS: readonly ClipView[] = ["now", "echo", "sculpt", "slit"];
export const CLIP_LOOPS: readonly ClipLoop[] = ["loop", "pingpong", "hold"];
export const CLIP_IDENTITIES: readonly ClipIdentity[] = ["tracked", "renewed"];
export const ECHO_BY: readonly EchoBy[] = ["gradient", "random", "species", "heat"];

export interface ClipSettings {
  playing: boolean;
  /** Clock speed, 0.1 to 3 (negative is not a speed: REMEMBER rewinds). */
  speed: number;
  loop: ClipLoop;
  identity: ClipIdentity;
  view: ClipView;
  echoBy: EchoBy;
  /** ECHO: the oldest moment a particle chases, in seconds behind now. */
  echoDepth: number;
  /** ECHO: how much of the swarm holds the present (0: spread evenly, 1: nearly all). */
  present: number;
  /** ECHO: how far the past comes apart into dust, 0..2. */
  dust: number;
  /** ECHO: how much colour and light the past loses, 0..1. */
  fade: number;
  /** SCULPT: shear through time, in world units a second. */
  shear: number;
  /** SLIT: slab thickness, as a multiple of one frame of travel. */
  slab: number;
}

/**
 * The defaults follow the reference Mehran gave (28 Oct 2026): a body held
 * crisp in the present, its own colour, while its trailing side comes apart
 * into a wide spray of dust that keeps less light the older it is.
 */
export const DEFAULT_CLIP_SETTINGS: Readonly<ClipSettings> = {
  playing: true,
  speed: 1,
  loop: "loop",
  identity: "tracked",
  view: "echo",
  echoBy: "gradient",
  echoDepth: 1.2,
  present: 0.55,
  dust: 1,
  fade: 0.7,
  shear: 1,
  slab: 1,
};

export const CLIP_SETTINGS_KEY = "void.clip.v1";

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

/** Anything (a stored record, a bad edit) into settings that are safe to play. Pure. */
export function sanitizeClipSettings(raw: unknown): ClipSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ClipSettings, unknown>>;
  const d = DEFAULT_CLIP_SETTINGS;
  return {
    playing: typeof r.playing === "boolean" ? r.playing : d.playing,
    speed: clampNum(r.speed, 0.1, 3, d.speed),
    loop: oneOf(r.loop, CLIP_LOOPS, d.loop),
    identity: oneOf(r.identity, CLIP_IDENTITIES, d.identity),
    view: oneOf(r.view, CLIP_VIEWS, d.view),
    echoBy: oneOf(r.echoBy, ECHO_BY, d.echoBy),
    echoDepth: clampNum(r.echoDepth, 0.05, 6, d.echoDepth),
    present: clampNum(r.present, 0, 1, d.present),
    dust: clampNum(r.dust, 0, 2, d.dust),
    fade: clampNum(r.fade, 0, 1, d.fade),
    shear: clampNum(r.shear, 0, 4, d.shear),
    slab: clampNum(r.slab, 0.25, 6, d.slab),
  };
}

function load(): ClipSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CLIP_SETTINGS_KEY) : null;
    return sanitizeClipSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeClipSettings(null);
  }
}

/** The one live settings object. */
export const clipSettings: ClipSettings = load();

export function saveClipSettings(): void {
  try {
    localStorage.setItem(CLIP_SETTINGS_KEY, JSON.stringify(clipSettings));
  } catch {
    // Private mode: the settings last this visit.
  }
}

/** One step through a list, wrapping: the keys cycle views and loop modes with it. */
export function nextOf<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length];
}

/** The speed the arrow keys step through. */
export const CLIP_SPEEDS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];

export function stepSpeed(speed: number, dir: 1 | -1): number {
  let best = 0;
  for (let i = 1; i < CLIP_SPEEDS.length; i++) {
    if (Math.abs(CLIP_SPEEDS[i] - speed) < Math.abs(CLIP_SPEEDS[best] - speed)) best = i;
  }
  return CLIP_SPEEDS[Math.max(0, Math.min(CLIP_SPEEDS.length - 1, best + dir))];
}
