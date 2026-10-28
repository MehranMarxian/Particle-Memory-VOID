import { MEMORY_STATE_ORDER, type MemoryStateName } from "@/memory/MemorySystem";

/**
 * The single source of truth for keyboard control, shared by the app
 * dispatch (app/main.ts) and the controls guide (ui/guide.ts):
 * the guide renders SHORTCUT_ROWS, the app runs handleKey(). Tests assert
 * the two cannot drift in either direction.
 */

export type ShortcutGroup = "MEMORY" | "LIFE" | "VISUAL" | "CLIP" | "SYSTEM";

export interface ShortcutRow {
  group: ShortcutGroup;
  /** What the guide prints in the key column, e.g. "1 - 5", "[ ]", "?". */
  display: string;
  /** The KeyboardEvent.key values this row documents (letters uppercase). */
  keys: string[];
  /** Convenience aliases that also dispatch but stay out of the key column. */
  aliases?: string[];
  /** Keys this row runs with Shift held (letters uppercase). */
  shiftKeys?: string[];
  label: string;
  hint: string;
}

export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  // A body that moves (4D memory): these act on a 4D clip, and say so when there is none.
  {
    group: "CLIP",
    display: "Q",
    keys: ["Q"],
    label: "Play / hold the clip",
    hint: "Let the moving memory move, or hold it at this moment.",
  },
  {
    group: "CLIP",
    display: "U",
    keys: ["U"],
    label: "Time view",
    hint: "NOW, ECHO (each particle a moment late), SCULPT and SLIT (the whole clip at once).",
  },
  {
    group: "CLIP",
    display: "J",
    keys: ["J"],
    label: "Loop",
    hint: "LOOP, PING-PONG, or HOLD the last moment.",
  },
  {
    group: "CLIP",
    display: "I",
    keys: ["I"],
    label: "Identity",
    hint: "TRACKED: each particle keeps its point of the body. RENEWED: the body drawn anew every instant.",
  },
  {
    group: "CLIP",
    display: "← →",
    keys: ["ArrowLeft", "ArrowRight"],
    label: "Scrub",
    hint: "One frame back or on (and hold there).",
  },
  {
    group: "CLIP",
    display: "↑ ↓",
    keys: ["ArrowUp", "ArrowDown"],
    label: "Clip speed",
    hint: "Faster or slower, from a tenth to three times.",
  },
  {
    group: "MEMORY",
    display: "1 - 5",
    keys: ["1", "2", "3", "4", "5"],
    label: "Memory states",
    hint: "Force one of the five states (listed below).",
  },
  {
    group: "MEMORY",
    display: "A",
    keys: ["A"],
    label: "Automatic cycle",
    hint: "Let memory and life trade places on their own.",
  },
  {
    group: "LIFE",
    display: "H",
    keys: ["H"],
    label: "Interaction behavior",
    hint: "Move to the next species matrix.",
  },
  {
    group: "LIFE",
    display: "R",
    keys: ["R"],
    label: "Randomize the organism",
    hint: "A fresh species matrix, never seen before.",
  },
  {
    group: "SYSTEM",
    display: "Shift R",
    // Shift + R: the key column's R is the organism's.
    keys: [],
    shiftKeys: ["R"],
    label: "Record",
    hint: "Film the piece and its soundscape to a WebM file; again to stop.",
  },
  {
    group: "MEMORY",
    display: "N",
    keys: ["N"],
    label: "Genesis",
    hint: "A ring of fire sweeps out from the heart and the memory re-forms behind it.",
  },
  {
    group: "LIFE",
    display: "Y",
    keys: ["Y"],
    label: "Ecology",
    hint: "Predation, birth and death. Species that hunt eat and starve.",
  },
  {
    group: "VISUAL",
    display: "C",
    keys: ["C"],
    label: "Color mode",
    hint: "Cycle monochrome, source, species, random, gradient.",
  },
  {
    group: "VISUAL",
    display: "K",
    keys: ["K"],
    label: "Sprite shape",
    hint: "Cycle circle, box, triangle, ring, star.",
  },
  {
    group: "VISUAL",
    display: "T",
    keys: ["T"],
    label: "Trails",
    hint: "Afterimage of where the organism has been.",
  },
  {
    group: "VISUAL",
    display: "D",
    keys: ["D"],
    label: "Depth of field",
    hint: "Focus falloff through the swarm.",
  },
  {
    group: "SYSTEM",
    display: "O",
    keys: ["O"],
    label: "Open a source",
    hint: "Choose a photograph, model or point cloud to remember.",
  },
  {
    group: "SYSTEM",
    display: "L",
    keys: ["L"],
    label: "Listen to sound",
    hint: "Music drives how the swarm looks: microphone or a shared tab, analysed here.",
  },
  {
    group: "SYSTEM",
    display: "E",
    keys: ["E"],
    label: "Evolve",
    hint: "Let VOID search its own interaction matrices, keeping what remembers better.",
  },
  {
    group: "SYSTEM",
    display: "P",
    keys: ["P"],
    label: "Control panel",
    hint: "Show or hide the instrument.",
  },
  {
    group: "SYSTEM",
    display: "F",
    keys: ["F"],
    label: "Fullscreen",
    hint: "Fill the screen with the memory.",
  },
  {
    group: "SYSTEM",
    display: "[ ]",
    keys: ["[", "]"],
    aliases: ["+"],
    label: "Particle density",
    hint: "Fewer or more particles remember the source.",
  },
  {
    group: "SYSTEM",
    display: "G",
    keys: ["G"],
    label: "Simulation backend",
    hint: "Switch between GPU and CPU.",
  },
  {
    group: "SYSTEM",
    display: ".",
    keys: ["."],
    label: "Pause",
    hint: "Hold the swarm still; the camera keeps breathing.",
  },
  {
    group: "SYSTEM",
    display: "M",
    keys: ["M"],
    label: "Capture",
    hint: "Save this moment as an image.",
  },
  {
    group: "SYSTEM",
    display: "Shift M",
    keys: [],
    shiftKeys: ["M"],
    label: "Capture in 4K",
    hint: "Save this moment 3840 pixels wide, whatever the screen.",
  },
  {
    group: "SYSTEM",
    display: "S",
    keys: ["S"],
    label: "Screensaver",
    hint: "Hands off; any input returns.",
  },
  {
    group: "SYSTEM",
    display: "V",
    keys: ["V"],
    label: "Presence",
    hint: "The camera sees who stands here, and the swarm remembers them. Nothing leaves this device.",
  },
  {
    group: "SYSTEM",
    display: "W",
    keys: ["W"],
    label: "Wind",
    hint: "The camera feels how the room moves: wave and the swarm scatters, stand still and it re-forms.",
  },
  {
    group: "SYSTEM",
    display: "X",
    keys: ["X"],
    label: "Exhibition",
    hint: "The piece plays itself for a room: every look in turn, with its statement.",
  },
  {
    group: "SYSTEM",
    display: "?",
    keys: ["?"],
    label: "This guide",
    hint: "Open or close these controls.",
  },
  {
    group: "SYSTEM",
    display: "ESC",
    keys: ["Escape"],
    label: "Exit / close",
    hint: "Leave fullscreen, or close this guide.",
  },
];

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ["MEMORY", "LIFE", "VISUAL", "CLIP", "SYSTEM"];

/** The five memory states, in cycle order, with their one-line meaning. */
export const MEMORY_STATE_GUIDE: readonly { name: MemoryStateName; line: string }[] = [
  { name: "RECONSTRUCT", line: "The memory returns to the source." },
  { name: "ALIVE", line: "Memory and life coexist." },
  { name: "DRIFT", line: "The memory begins to weaken." },
  { name: "VOID", line: "The source is almost forgotten." },
  { name: "REMEMBER", line: "The organism finds its way back." },
];

/** Everything handleKey needs to do its job (all side effects live here). */
export interface ShortcutContext {
  togglePanel(): void;
  toggleColor(): void;
  toggleShape(): void;
  toggleTrails(): void;
  toggleDof(): void;
  toggleCycle(): void;
  cycleMatrix(): void;
  randomizeMatrix(): void;
  toggleFullscreen(): void;
  densityUp(): void;
  densityDown(): void;
  toggleBackend(): void;
  toggleScreensaver(): void;
  /** Simulation pause: steps stop, the camera keeps breathing. */
  togglePause(): void;
  /** Save the current frame through the HDR chain. */
  captureMoment(): void;
  setMemoryState(index: number): void;
  toggleGuide(): void;
  closeGuide(): void;
  isGuideOpen(): boolean;
  openSource(): void;
  toggleSound(): void;
  toggleEvolve(): void;
  toggleEcology(): void;
  /** GENESIS: release, a ring of fire, reconstruction. */
  genesis(): void;
  /** PRESENCE: the swarm remembers the visitor in front of the camera. */
  togglePresence(): void;
  /** WIND: the camera feels how the room moves, and the swarm answers. */
  toggleWind(): void;
  /** EXHIBITION: the authored programme, inside the screensaver. */
  startExhibition(): void;
  /** Shift R (0.12): start or stop filming the piece. */
  toggleRecording?(): void;
  /** Shift M (0.13): capture the moment in 4K. */
  captureHiRes?(): void;
  /** The 4D clip (4D memory): play or hold, view, loop, identity, scrub, speed. */
  clipPlay(): void;
  clipView(): void;
  clipLoop(): void;
  clipIdentity(): void;
  clipScrub(frames: number): void;
  clipSpeed(dir: 1 | -1): void;
}

export interface KeyModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** True when the event target is a text-entry surface we must not disturb. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["range", "checkbox", "radio", "button", "file"].includes(target.type);
  }
  return false;
}

/** Dispatch one keydown. Returns true when the key was consumed. */
export function handleKey(rawKey: string, ctx: ShortcutContext, modifiers: KeyModifiers = {}): boolean {
  // Browser combinations (cmd/ctrl + key) are never ours.
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return false;
  if (rawKey === "Escape") {
    if (ctx.isGuideOpen()) {
      ctx.closeGuide();
      return true;
    }
    return false; // fullscreen exit stays browser-native
  }
  if (rawKey === "?") {
    ctx.toggleGuide();
    return true;
  }
  switch (rawKey) {
    case "ArrowLeft":
      ctx.clipScrub(-1);
      return true;
    case "ArrowRight":
      ctx.clipScrub(1);
      return true;
    case "ArrowUp":
      ctx.clipSpeed(1);
      return true;
    case "ArrowDown":
      ctx.clipSpeed(-1);
      return true;
  }
  const key = rawKey.toUpperCase();
  switch (key) {
    case "Q":
      ctx.clipPlay();
      return true;
    case "U":
      ctx.clipView();
      return true;
    case "J":
      ctx.clipLoop();
      return true;
    case "I":
      ctx.clipIdentity();
      return true;
    case "E":
      ctx.toggleEvolve();
      return true;
    case "N":
      ctx.genesis();
      return true;
    case "V":
      ctx.togglePresence();
      return true;
    case "W":
      ctx.toggleWind();
      return true;
    case "X":
      ctx.startExhibition();
      return true;
    case "Y":
      ctx.toggleEcology();
      return true;
    case "L":
      ctx.toggleSound();
      return true;
    case "O":
      ctx.openSource();
      return true;
    case "P":
      ctx.togglePanel();
      return true;
    case "C":
      ctx.toggleColor();
      return true;
    case "K":
      ctx.toggleShape();
      return true;
    case "T":
      ctx.toggleTrails();
      return true;
    case "D":
      ctx.toggleDof();
      return true;
    case "A":
      ctx.toggleCycle();
      return true;
    case "H":
      ctx.cycleMatrix();
      return true;
    case "R":
      if (modifiers.shiftKey && ctx.toggleRecording) ctx.toggleRecording();
      else ctx.randomizeMatrix();
      return true;
    case "F":
      ctx.toggleFullscreen();
      return true;
    case "G":
      ctx.toggleBackend();
      return true;
    case "S":
      ctx.toggleScreensaver();
      return true;
    case ".":
      ctx.togglePause();
      return true;
    case "M":
      if (modifiers.shiftKey && ctx.captureHiRes) ctx.captureHiRes();
      else ctx.captureMoment();
      return true;
    case "]":
    case "+":
      ctx.densityUp();
      return true;
    case "[":
      ctx.densityDown();
      return true;
    default: {
      const idx = Number(key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < MEMORY_STATE_ORDER.length) {
        ctx.setMemoryState(idx);
        return true;
      }
      return false;
    }
  }
}
