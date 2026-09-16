import { MEMORY_STATE_ORDER, type MemoryStateName } from "@/memory/MemorySystem";

/**
 * The single source of truth for keyboard control, shared by the app
 * dispatch (app/main.ts) and the controls guide (ui/guide.ts):
 * the guide renders SHORTCUT_ROWS, the app runs handleKey(). Tests assert
 * the two cannot drift in either direction.
 */

export type ShortcutGroup = "MEMORY" | "LIFE" | "VISUAL" | "SYSTEM";

export interface ShortcutRow {
  group: ShortcutGroup;
  /** What the guide prints in the key column, e.g. "1 - 5", "[ ]", "?". */
  display: string;
  /** The KeyboardEvent.key values this row documents (letters uppercase). */
  keys: string[];
  /** Convenience aliases that also dispatch but stay out of the key column. */
  aliases?: string[];
  label: string;
  hint: string;
}

export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
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
    group: "VISUAL",
    display: "C",
    keys: ["C"],
    label: "Color mode",
    hint: "Monochrome or the source's own colors.",
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
    display: "S",
    keys: ["S"],
    label: "Screensaver",
    hint: "Hands off; any input returns.",
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

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ["MEMORY", "LIFE", "VISUAL", "SYSTEM"];

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
  setMemoryState(index: number): void;
  toggleGuide(): void;
  closeGuide(): void;
  isGuideOpen(): boolean;
  openSource(): void;
  toggleSound(): void;
  toggleEvolve(): void;
}

export interface KeyModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
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
  const key = rawKey.toUpperCase();
  switch (key) {
    case "E":
      ctx.toggleEvolve();
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
      ctx.randomizeMatrix();
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
