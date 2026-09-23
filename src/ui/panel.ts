import type { EngineParams } from "@/types";
import type { AudioSource } from "@/audio/audioReactive";
import {
  COLOR_MODES,
  GRADIENT_AXES,
  PARTICLE_SHAPES,
  type ColorMode,
  type GradientAxis,
  type ParticleShape,
  type VisualSettings,
} from "@/rendering/VisualSettings";
import { GRADIENT_PALETTE_NAMES, paletteStops } from "@/rendering/palette";
import type { MemorySystem } from "@/memory/MemorySystem";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { PRESET_DEFINITIONS, type PresetDefinition } from "@/presets/presets";
import {
  MACRO_LABELS,
  MACRO_ORDER,
  MACRO_TIPS,
  type MacroName,
  type MacroValues,
} from "@/presets/macros";
import { icon, type IconName } from "./icons";
import "./panel.css";

/**
 * The studio (v0.11.0). The instrument is laid out like a painter's
 * application, so it can be read by position before it is read by word:
 *
 *   TOP BAR      the great gestures, each an icon with its name under it:
 *                SOURCE, MOON DUST, GENESIS, RECONSTRUCT, RELEASE, PAUSE,
 *                CAPTURE - then the room (screensaver, fullscreen), the
 *                window toggles, the guide and HIDE.
 *   TOOL RAIL    left edge. One icon per thing you can touch with your eyes
 *                (size, glow, colour, shape, trails, focus, hand, dots,
 *                species, sound). A tool opens a small flyout beside it.
 *   PROPERTIES   right edge (#panel). Every parameter, in sections that fold
 *                independently: MOTION, MEMORY, LIFE, FIELD, SCENT & HEAT,
 *                ECOLOGY, VISUAL, SOUND, EVOLVE, LAB.
 *   LOOKS DOCK   bottom. The looks as faces, and RANDOM / UNDO / RESET.
 *
 * Each panel can be closed, reopened from the top bar, and the layout is
 * remembered per browser. Built from declarative specs so a parameter is
 * still one line; nothing about behaviour lives here.
 */

export interface PanelCallbacks {
  onDensityChange(count: number): void;
  onAddSource(): void;
  onPreset(name: string): void;
  /** A macro slider moved. The app applies it and exits the authored cycle for engine macros. */
  onMacro(name: MacroName): void;
  onRandomize(): void;
  onUndo(): void;
  onReset(): void;
  onReconstruct(): void;
  onRelease(): void;
  /** GENESIS: the ring of fire that re-forms the memory. */
  onGenesis(): void;
  onFullscreen(): void;
  onScreensaver(): void;
  onTogglePause(): void;
  onCapture(): void;
  onBackendToggle(): void;
  onSpeciesChange(n: number): void;
  onUserInteraction(): void;
  onToggleCycle(): void;
  onToggleGuide(): void;
  onEcologyToggle(): void;
  onSoundToggle(): void;
  onEvolveToggle(): void;
  onSoundSourceChange(): void;
  onSoundscapeToggle(): void;
  /** PRESENCE: the camera switch (the app owns the camera). */
  onPresenceToggle(): void;
  /** EXHIBITION: the authored programme, inside the screensaver. */
  onExhibition(): void;
}

export interface PanelApi {
  readonly element: HTMLElement;
  setSourceInfo(name: string, kind: string, detail: string, count: number): void;
  setCount(count: number): void;
  setActivePreset(name: string | null): void;
  /** Reflect the simulation-pause state on the PAUSE/PLAY action. */
  setPaused(paused: boolean): void;
  setState(name: string): void;
  setStats(text: string): void;
  setHint(text: string, seconds: number, sticky: boolean): void;
  setEvolve(text: string): void;
  clearHint(): void;
  toggleVisible(): void;
  refresh(): void;
}

export type StudioPanel = "tools" | "props" | "looks";
type Layout = Record<StudioPanel, boolean>;
export const LAYOUT_KEY = "void.layout.v1";

function loadLayout(fallback: Layout): Layout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return {
      tools: typeof parsed.tools === "boolean" ? parsed.tools : fallback.tools,
      props: typeof parsed.props === "boolean" ? parsed.props : fallback.props,
      looks: typeof parsed.looks === "boolean" ? parsed.looks : fallback.looks,
    };
  } catch {
    return fallback;
  }
}

function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* private mode: the layout is simply not remembered */
  }
}

/** A CSS gradient that previews an authored palette. */
export function paletteCss(name: string): string {
  const stops = paletteStops(name)
    .map((s) => `rgb(${s.rgb.map((v) => Math.round(v * 255)).join(",")}) ${Math.round(s.t * 100)}%`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

/** The face of a look with no thumbnail: its own palette as light. */
function presetSwatchCss(def: PresetDefinition): string {
  const mode = def.visual?.colorMode;
  if (mode === "gradient") {
    const stops = paletteStops(def.visual?.gradientPalette ?? "DUSK");
    const mid = stops[Math.floor(stops.length / 2)].rgb.map((v) => Math.round(v * 255)).join(",");
    const end = stops[stops.length - 1].rgb.map((v) => Math.round(v * 255)).join(",");
    return `radial-gradient(circle at 50% 55%, rgb(${end}) 0%, rgb(${mid}) 22%, rgba(0,0,0,0) 62%), #000`;
  }
  if (mode === "species" || mode === "random") {
    return "radial-gradient(circle at 35% 45%, #c4506e 0 10%, transparent 30%), radial-gradient(circle at 65% 40%, #4a9fd1 0 10%, transparent 30%), radial-gradient(circle at 50% 68%, #e3c24f 0 10%, transparent 30%), #000";
  }
  return "radial-gradient(circle at 50% 55%, #e8e8ee 0%, #6d6f78 20%, rgba(0,0,0,0) 60%), #000";
}

const SHAPE_PATHS: Record<ParticleShape, string> = {
  circle: "M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0",
  box: "M5 5h14v14H5z",
  triangle: "M12 4l8.5 15h-17z",
  ring: "M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z",
};

function shapeGlyph(shape: ParticleShape): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", SHAPE_PATHS[shape]);
  p.setAttribute("fill", "currentColor");
  p.setAttribute("fill-rule", "evenodd");
  svg.appendChild(p);
  return svg;
}

const COLOR_SWATCH: Record<ColorMode, string> = {
  monochrome: "linear-gradient(135deg, #2a2a30, #f2f2f6)",
  source: "linear-gradient(135deg, #7a5a3a 0 33%, #3f6f8f 33% 66%, #c9b28a 66%)",
  species: "linear-gradient(90deg, #c4506e 0 25%, #4a9fd1 25% 50%, #e3c24f 50% 75%, #5fbf87 75%)",
  random: "conic-gradient(#e0506a, #e3c24f, #5fbf87, #4a9fd1, #9a5fd1, #e0506a)",
  gradient: "linear-gradient(90deg, #232b4c, #9a456b, #f2ad61)",
};

export function createPanel(opts: {
  params: EngineParams;
  visual: VisualSettings;
  memory: MemorySystem;
  matrix: InteractionMatrix;
  speciesCount: number;
  currentCount: number;
  /** The live macro positions (the MOTION section reads and writes them). */
  macros: MacroValues;
  sound: { enabled: boolean; sensitivity: number; source: AudioSource };
  soundscape: { enabled: boolean; volume: number };
  evolve: { enabled: boolean; trialSeconds: number; mutation: number; phenotype: boolean; ecology: boolean };
  pointer: { strength: number; mode: number; ghost: boolean };
  callbacks: PanelCallbacks;
  /** Live backend label for the LAB's SIM button. */
  backend: () => "gpu" | "cpu";
  ecology: {
    enabled: boolean;
    captureRadius: number;
    killChance: number;
    starveSeconds: number;
    ageRisk: number;
    reproductionSatiation: number;
    audioReactive: boolean;
  };
  ecologyEvents: { births: number; deaths: number };
  /** The visitor's camera switch (PRESENCE); the app turns it on and off. */
  presence: { enabled: boolean };
  /** Called when a change needs the particle buffers re-baked (colour/shape). */
  onLookChange?: () => void;
}): PanelApi {
  const { params, visual, memory, callbacks, sound, evolve, pointer, soundscape, ecology, ecologyEvents, onLookChange, backend, macros, presence } = opts;
  let speciesCount = opts.speciesCount;
  let currentCount = opts.currentCount;

  const syncFns: Array<() => void> = [];
  const syncAll = () => {
    for (const fn of syncFns) fn();
  };
  let evolveReadout: HTMLElement | null = null;

  const studio = document.createElement("div");
  studio.id = "void-studio";

  // --- The status toast: hints, tips, errors. Touch has no hover, so rows
  // show their meaning here on a press-and-hold.
  const status = document.createElement("div");
  status.id = "panel-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  let statusTimer = 0;
  function showStatus(text: string, seconds: number, cls: "tip" | "error" | "" = ""): void {
    status.textContent = text;
    status.classList.remove("tip", "error");
    if (cls) status.classList.add(cls);
    status.classList.toggle("shown", text !== "");
    window.clearTimeout(statusTimer);
    if (seconds > 0) {
      statusTimer = window.setTimeout(() => {
        status.textContent = "";
        status.classList.remove("shown", "tip");
      }, seconds * 1000);
    }
  }

  function attachTip(row: HTMLElement, tip: string): void {
    let hold = 0;
    const label = row.querySelector("label");
    if (!label) return;
    label.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return; // hover already has the title
      hold = window.setTimeout(() => showStatus(tip, 2.6, "tip"), 350);
    });
    const cancel = () => window.clearTimeout(hold);
    label.addEventListener("pointerup", cancel);
    label.addEventListener("pointercancel", cancel);
    label.addEventListener("pointerleave", cancel);
  }

  /** An icon button with its name beneath (or beside, in a row). */
  function iconBtn(
    parent: HTMLElement,
    action: string,
    iconName: IconName,
    label: string,
    fn: () => void,
    title?: string
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "ibtn";
    b.dataset.action = action;
    b.setAttribute("aria-label", title ?? label);
    b.title = title ?? label;
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = label;
    b.append(icon(iconName), lbl);
    b.addEventListener("click", fn);
    parent.appendChild(b);
    return b;
  }

  function addSlider(
    body: HTMLElement,
    label: string,
    spec: { min: number; max: number; step: number },
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string,
    live: boolean,
    tip?: string
  ): void {
    const row = document.createElement("div");
    row.className = "row";
    if (tip) row.title = tip;
    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(get());
    input.setAttribute("aria-label", label);
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = format(get());
    const paintFill = () => {
      const t = (Number(input.value) - spec.min) / Math.max(1e-9, spec.max - spec.min);
      input.style.setProperty("--fill", `${Math.max(0, Math.min(1, t)) * 100}%`);
    };
    paintFill();
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      val.textContent = format(v);
      paintFill();
      if (live) {
        callbacks.onUserInteraction();
        syncAll();
      }
    });
    if (!live) {
      input.addEventListener("change", () => callbacks.onUserInteraction());
    }
    row.append(labelEl, input, val);
    body.appendChild(row);
    if (tip) attachTip(row, tip);
    syncFns.push(() => {
      const v = get();
      input.value = String(v);
      val.textContent = format(v);
      paintFill();
    });
  }

  const num = (v: number) => v.toFixed(2);

  function addObjSlider(
    body: HTMLElement,
    label: string,
    obj: object,
    key: string,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    tip?: string
  ): void {
    const o = obj as unknown as Record<string, unknown>;
    addSlider(
      body,
      label,
      { min, max, step },
      () => Number(o[key] ?? 0),
      (v) => {
        o[key] = v;
      },
      format,
      true,
      tip
    );
  }

  function addToggle(
    body: HTMLElement,
    label: string,
    get: () => boolean,
    set: (v: boolean) => void,
    onLabel: string,
    offLabel: string,
    tip?: string
  ): void {
    const row = document.createElement("div");
    row.className = "row";
    if (tip) row.title = tip;
    const lbl = document.createElement("label");
    lbl.textContent = label;
    const btn = document.createElement("button");
    btn.className = "switch";
    btn.setAttribute("role", "switch");
    const knob = document.createElement("span");
    knob.className = "knob";
    const text = document.createElement("span");
    text.className = "switch-text";
    btn.append(knob, text);
    const paint = () => {
      const on = get();
      text.textContent = on ? onLabel : offLabel;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-checked", String(on));
      btn.setAttribute("aria-label", `${label}: ${on ? onLabel : offLabel}`);
    };
    btn.addEventListener("click", () => {
      set(!get());
      paint();
      callbacks.onUserInteraction();
      syncAll();
    });
    paint();
    row.append(lbl, btn);
    body.appendChild(row);
    if (tip) attachTip(row, tip);
    syncFns.push(paint);
  }

  /**
   * A one-of-N row: a label plus a grid of buttons, one selected at a time.
   * `face` draws each option (a swatch, a glyph) so the choice is visible
   * before it is read. `visible` hides the row when it does not apply yet.
   */
  function addChoiceRow(
    body: HTMLElement,
    label: string,
    options: readonly string[],
    current: () => string,
    choose: (value: string) => void,
    tip?: string,
    visible?: () => boolean,
    face?: (option: string, button: HTMLButtonElement) => void
  ): void {
    const row = document.createElement("div");
    row.className = "row choice";
    if (tip) row.title = tip;
    const lbl = document.createElement("label");
    lbl.textContent = label;
    const grid = document.createElement("div");
    grid.className = face ? "choice-grid faces" : "choice-grid";
    const buttons = new Map<string, HTMLButtonElement>();
    for (const option of options) {
      const b = document.createElement("button");
      b.className = "chip";
      b.title = option.toLowerCase();
      b.setAttribute("aria-label", `${label}: ${option.toLowerCase()}`);
      if (face) face(option, b);
      else b.textContent = option.toUpperCase();
      b.addEventListener("click", () => {
        if (current() === option) return;
        choose(option);
        callbacks.onUserInteraction();
        syncAll();
      });
      buttons.set(option, b);
      grid.appendChild(b);
    }
    function paint(): void {
      const active = current();
      for (const [option, b] of buttons) {
        b.classList.toggle("on", option === active);
        b.setAttribute("aria-pressed", String(option === active));
      }
      if (visible) row.style.display = visible() ? "" : "none";
    }
    paint();
    syncFns.push(paint);
    row.append(lbl, grid);
    body.appendChild(row);
    if (tip) attachTip(row, tip);
  }

  function addNote(body: HTMLElement, text: string): HTMLElement {
    const note = document.createElement("div");
    note.className = "meta";
    note.textContent = text;
    body.appendChild(note);
    return note;
  }

  // Shared control groups: the tool flyouts and the properties sections draw
  // the same controls, so both stay in step through syncAll.
  const lookChanged = () => onLookChange?.();

  function colorControls(body: HTMLElement): void {
    addChoiceRow(
      body,
      "Color",
      COLOR_MODES,
      () => visual.colorMode,
      (v) => {
        visual.colorMode = v as ColorMode;
        lookChanged();
      },
      "Monochrome, the source's own colors, one hue per species, a seeded hue per particle, or an authored ramp.",
      undefined,
      (option, b) => {
        const sw = document.createElement("span");
        sw.className = "swatch";
        sw.style.background = COLOR_SWATCH[option as ColorMode];
        const t = document.createElement("span");
        t.className = "chip-text";
        t.textContent = option === "monochrome" ? "MONO" : option.toUpperCase();
        b.append(sw, t);
      }
    );
    addChoiceRow(
      body,
      "Ramp",
      GRADIENT_PALETTE_NAMES,
      () => visual.gradientPalette,
      (v) => {
        visual.gradientPalette = v;
        lookChanged();
      },
      "Authored gradient palettes.",
      () => visual.colorMode === "gradient",
      (option, b) => {
        const sw = document.createElement("span");
        sw.className = "swatch wide";
        sw.style.background = paletteCss(option);
        const t = document.createElement("span");
        t.className = "chip-text";
        t.textContent = option;
        b.append(sw, t);
      }
    );
    addChoiceRow(
      body,
      "Axis",
      GRADIENT_AXES,
      () => visual.gradientAxis,
      (v) => {
        visual.gradientAxis = v as GradientAxis;
        lookChanged();
      },
      "What the ramp is mapped across: a particle's own life, its distance from the camera or the centre, or the scent and heat it moves through.",
      () => visual.colorMode === "gradient"
    );
  }

  function shapeControls(body: HTMLElement): void {
    addChoiceRow(
      body,
      "Shape",
      PARTICLE_SHAPES,
      () => (visual.shapeBySpecies ? "" : visual.shape),
      (v) => {
        visual.shape = v as ParticleShape;
        visual.shapeBySpecies = false;
        lookChanged();
      },
      "Sprite shape, drawn analytically - no textures, no extra geometry.",
      undefined,
      (option, b) => b.appendChild(shapeGlyph(option as ParticleShape))
    );
    addToggle(
      body,
      "By species",
      () => visual.shapeBySpecies,
      (v) => {
        visual.shapeBySpecies = v;
        lookChanged();
      },
      "ON",
      "OFF",
      "Give each species its own shape, so the ecosystem reads at a glance."
    );
  }

  function trailControls(body: HTMLElement): void {
    addToggle(body, "Trails", () => visual.trails, (v) => (visual.trails = v), "ON", "OFF", "Afterimage of where the organism has been.");
    addObjSlider(body, "Length", visual, "trailDecay", 0.2, 0.95, 0.01, num, "How long the afterimage lingers.");
  }

  function densityControls(body: HTMLElement): void {
    addSlider(
      body,
      "Particles",
      // The menu ends where the GPU budget ends; the CPU backend clamps
      // further (see simPolicy) and says so when it does.
      { min: 1000, max: 50000, step: 1000 },
      () => currentCount,
      (v) => {
        currentCount = v;
        callbacks.onDensityChange(v);
      },
      (v) => `${(v / 1000).toFixed(0)}k`,
      false,
      "How many particles remember the source."
    );
  }

  function speciesControls(body: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "row";
    row.title = "How many species share the memory.";
    const label = document.createElement("label");
    label.textContent = "Species";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "2";
    input.max = "8";
    input.step = "1";
    input.value = String(speciesCount);
    input.setAttribute("aria-label", "Species");
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = String(speciesCount);
    const paintFill = () => input.style.setProperty("--fill", `${((Number(input.value) - 2) / 6) * 100}%`);
    paintFill();
    input.addEventListener("input", () => {
      val.textContent = input.value;
      paintFill();
    });
    input.addEventListener("change", () => {
      speciesCount = Number(input.value);
      callbacks.onSpeciesChange(speciesCount);
      syncAll();
    });
    row.append(label, input, val);
    body.appendChild(row);
    attachTip(row, "How many species share the memory.");
    syncFns.push(() => {
      input.value = String(speciesCount);
      val.textContent = String(speciesCount);
      paintFill();
    });
  }

  function kernelControls(body: HTMLElement): void {
    addChoiceRow(
      body,
      "Kernel",
      ["pulse", "inverse", "linear"],
      () => params.life.kernel,
      (v) => {
        params.life.kernel = v as typeof params.life.kernel;
      },
      "The shape of the force between particles."
    );
  }

  function handControls(body: HTMLElement): void {
    addObjSlider(body, "Strength", pointer, "strength", 0, 3, 0.05, num, "How strongly the swarm leans toward your pointer.");
    addToggle(body, "Mode", () => pointer.mode > 0, (v) => (pointer.mode = v ? 1 : -1), "PULL", "PUSH", "Attract to the pointer, or push away from it.");
    addObjSlider(body, "Ripples", params.pointer, "ripple", 0, 2, 0.05, num, "Your movement rings the swarm like water.");
  }

  function soundControls(body: HTMLElement): void {
    addToggle(
      body,
      "Listen",
      () => sound.enabled,
      (v) => {
        sound.enabled = v;
        callbacks.onSoundToggle();
      },
      "ON",
      "OFF",
      "Music drives how the swarm looks; the audio is analysed here and never sent."
    );
    addObjSlider(body, "Sensitivity", sound, "sensitivity", 0.2, 3, 0.05, num, "How strongly sound moves the swarm.");
    addChoiceRow(
      body,
      "Input",
      ["mic", "tab"],
      () => sound.source,
      (v) => {
        sound.source = v as AudioSource;
        callbacks.onSoundSourceChange();
      },
      "Where the sound comes from: your microphone, or the audio of a tab you share."
    );
    addToggle(
      body,
      "Soundscape",
      () => soundscape.enabled,
      (v) => {
        soundscape.enabled = v;
        callbacks.onSoundscapeToggle();
      },
      "ON",
      "OFF",
      "A hum that rises with stress, and a whisper while the memory re-forms."
    );
    addObjSlider(body, "Volume", soundscape, "volume", 0, 1, 0.01, num, "How loud the soundscape is.");
  }

  // --- TOP BAR -----------------------------------------------------------------
  const topbar = document.createElement("header");
  topbar.id = "void-topbar";
  studio.appendChild(topbar);

  const brand = document.createElement("div");
  brand.className = "brand";
  brand.innerHTML = `<img src="${import.meta.env.BASE_URL}icons/void-64.png" alt="" /><span class="word">VOID</span>`;
  const stateChip = document.createElement("span");
  stateChip.id = "panel-state";
  stateChip.textContent = "RECONSTRUCT";
  brand.appendChild(stateChip);
  topbar.appendChild(brand);

  // The source chip: what VOID remembers, and the door to change it.
  const sourceChip = document.createElement("button");
  sourceChip.id = "panel-source-chip";
  sourceChip.addEventListener("click", () => callbacks.onAddSource());
  topbar.appendChild(sourceChip);

  const actions = document.createElement("div");
  actions.className = "actions";
  topbar.appendChild(actions);
  iconBtn(actions, "source", "source", "SOURCE", () => callbacks.onAddSource(), "Open a photo, model or point cloud (O)");
  const moon = iconBtn(
    actions,
    "moon",
    "moon",
    "MOON DUST",
    () => callbacks.onPreset("moon"),
    "Moon Dust, the signature look: ripples under your hand, luminous trails, and a swarm that comes home"
  );
  moon.classList.add("moon");
  const genesis = iconBtn(actions, "genesis", "genesis", "GENESIS", () => callbacks.onGenesis(), "Genesis: a ring of fire re-forms the memory (N)");
  genesis.classList.add("genesis");
  iconBtn(actions, "reconstruct", "reconstruct", "RECONSTRUCT", () => callbacks.onReconstruct(), "Pull the swarm back into the memory (1)");
  iconBtn(actions, "release", "release", "RELEASE", () => callbacks.onRelease(), "Let the memory go (4)");
  // Simulation pause, distinct from the screensaver and the memory cycle:
  // steps stop, the camera and trails keep breathing.
  const pauseBtn = iconBtn(actions, "pause", "pause", "PAUSE", () => callbacks.onTogglePause(), "Hold the moment (.)");
  iconBtn(actions, "capture", "capture", "CAPTURE", () => callbacks.onCapture(), "Save this moment as an image (M)");

  const room = document.createElement("div");
  room.className = "actions room";
  topbar.appendChild(room);
  iconBtn(room, "screensaver", "screensaver", "SCREENSAVER", () => callbacks.onScreensaver(), "Hands off; any input returns (S)");
  iconBtn(room, "exhibit", "exhibit", "EXHIBIT", () => callbacks.onExhibition(), "The piece plays itself for a room: every look, with its statement (X)");
  iconBtn(room, "fullscreen", "fullscreen", "FULLSCREEN", () => callbacks.onFullscreen(), "Fill the screen (F)");

  const windows = document.createElement("div");
  windows.className = "actions windows";
  topbar.appendChild(windows);

  // --- TOOL RAIL + FLYOUT ------------------------------------------------------
  const tools = document.createElement("nav");
  tools.id = "void-tools";
  tools.setAttribute("aria-label", "Tools");
  studio.appendChild(tools);
  const flyout = document.createElement("div");
  flyout.id = "void-flyout";
  flyout.hidden = true;
  studio.appendChild(flyout);

  interface ToolDef {
    id: string;
    icon: IconName;
    label: string;
    tip: string;
    build(body: HTMLElement): void;
    active?: () => boolean;
  }
  const TOOLS: ToolDef[] = [
    {
      id: "size",
      icon: "size",
      label: "SIZE",
      tip: "How big each particle is",
      build: (b) => {
        addObjSlider(b, "Size", visual, "particleSize", 0.4, 4, 0.05, num, "How big each particle is.");
        addObjSlider(b, "Opacity", visual, "opacity", 0.05, 1, 0.01, num, "How solid each particle is.");
      },
    },
    {
      id: "glow",
      icon: "glow",
      label: "GLOW",
      tip: "How much light each particle gives",
      build: (b) => addObjSlider(b, "Glow", visual, "glow", 0, 2, 0.05, num, "How much light each particle gives."),
    },
    { id: "color", icon: "color", label: "COLOR", tip: "Paint the swarm", build: colorControls },
    { id: "shape", icon: "shape", label: "SHAPE", tip: "Circles, boxes, triangles, rings, stars", build: shapeControls },
    { id: "trails", icon: "trails", label: "TRAILS", tip: "Afterimages of movement", build: trailControls, active: () => visual.trails },
    {
      id: "focus",
      icon: "focus",
      label: "FOCUS",
      tip: "Depth of field and fog",
      build: (b) => {
        addObjSlider(b, "Depth", visual, "dof", 0, 1, 0.01, num, "Depth-of-field focus falloff.");
        addObjSlider(b, "Fog", visual, "fogDensity", 0, 0.12, 0.002, (v) => v.toFixed(3), "How the far swarm fades into the dark.");
      },
      active: () => visual.dof > 0,
    },
    { id: "hand", icon: "hand", label: "HAND", tip: "What your pointer does to the swarm", build: handControls, active: () => pointer.strength > 0 || params.pointer.ripple > 0 },
    { id: "density", icon: "density", label: "DOTS", tip: "How many particles", build: densityControls },
    {
      id: "species",
      icon: "species",
      label: "KINDS",
      tip: "How many species, and how they touch",
      build: (b) => {
        speciesControls(b);
        kernelControls(b);
      },
    },
    { id: "sound", icon: "sound", label: "SOUND", tip: "Listen, and let the swarm sing", build: soundControls, active: () => sound.enabled || soundscape.enabled },
    {
      id: "presence",
      icon: "presence",
      label: "YOU",
      tip: "Stand in front of the camera and the swarm remembers you",
      build: (b) => {
        addToggle(
          b,
          "Presence",
          () => presence.enabled,
          () => callbacks.onPresenceToggle(),
          "ON",
          "OFF",
          "The camera sees who stands here, and the swarm takes their shape. Walk away and it lets you go."
        );
        addNote(b, "STAND STILL FOR A MOMENT WHEN IT STARTS - IT LEARNS THE EMPTY ROOM FIRST.\nTHE CAMERA IS READ AT 96 X 72, IN GREY, AND NOTHING IS KEPT OR SENT.");
      },
      active: () => presence.enabled,
    },
  ];

  const toolButtons = new Map<string, HTMLButtonElement>();
  const toolBodies = new Map<string, HTMLElement>();
  let openTool: string | null = null;

  const flyoutHead = document.createElement("div");
  flyoutHead.className = "flyout-head";
  const flyoutTitle = document.createElement("span");
  const flyoutClose = document.createElement("button");
  flyoutClose.className = "close";
  flyoutClose.setAttribute("aria-label", "Close");
  flyoutClose.appendChild(icon("close", 14));
  flyoutClose.addEventListener("click", () => setTool(null));
  flyoutHead.append(flyoutTitle, flyoutClose);
  flyout.appendChild(flyoutHead);

  for (const tool of TOOLS) {
    const b = iconBtn(tools, `tool-${tool.id}`, tool.icon, tool.label, () => setTool(openTool === tool.id ? null : tool.id), tool.tip);
    b.classList.add("tool");
    toolButtons.set(tool.id, b);
    const body = document.createElement("div");
    body.className = "flyout-body";
    body.hidden = true;
    tool.build(body);
    flyout.appendChild(body);
    toolBodies.set(tool.id, body);
    if (tool.active) {
      const active = tool.active;
      syncFns.push(() => b.classList.toggle("lit", active()));
    }
  }

  function setTool(id: string | null): void {
    openTool = id;
    flyout.hidden = id === null;
    for (const [tid, body] of toolBodies) body.hidden = tid !== id;
    for (const [tid, b] of toolButtons) {
      b.classList.toggle("on", tid === id);
      b.setAttribute("aria-expanded", String(tid === id));
    }
    if (id) {
      const def = TOOLS.find((t) => t.id === id)!;
      flyoutTitle.textContent = def.label;
      const b = toolButtons.get(id)!;
      const rect = b.getBoundingClientRect();
      flyout.style.top = `${Math.max(60, Math.min(rect.top, window.innerHeight - 320))}px`;
    }
  }
  window.addEventListener("pointerdown", (e) => {
    if (openTool === null) return;
    const t = e.target as Node | null;
    if (t && (flyout.contains(t) || tools.contains(t))) return;
    setTool(null);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openTool !== null) setTool(null);
  });

  // --- PROPERTIES (#panel) -----------------------------------------------------
  const panel = document.createElement("aside");
  panel.id = "panel";
  panel.setAttribute("aria-label", "Properties");
  studio.appendChild(panel);

  const head = document.createElement("div");
  head.className = "panel-head";
  const headTitle = document.createElement("span");
  headTitle.textContent = "PROPERTIES";
  const headClose = document.createElement("button");
  headClose.className = "close";
  headClose.setAttribute("aria-label", "Close properties");
  headClose.appendChild(icon("close", 14));
  headClose.addEventListener("click", () => setPanelOpen("props", false));
  head.append(headTitle, headClose);
  panel.appendChild(head);

  const sectionsEl = document.createElement("div");
  sectionsEl.className = "panel-sections";
  panel.appendChild(sectionsEl);

  function section(title: string, iconName: IconName, open = false): HTMLElement {
    const sec = document.createElement("section");
    sec.dataset.section = title;
    if (!open) sec.classList.add("closed");
    const h = document.createElement("h3");
    const btn = document.createElement("button");
    btn.className = "section-toggle";
    btn.setAttribute("aria-expanded", String(open));
    const t = document.createElement("span");
    t.className = "section-title";
    t.textContent = title;
    const chev = icon("chevron", 14);
    chev.classList.add("chev");
    btn.append(icon(iconName, 16), t, chev);
    btn.addEventListener("click", () => {
      const closed = sec.classList.toggle("closed");
      btn.setAttribute("aria-expanded", String(!closed));
    });
    h.appendChild(btn);
    const body = document.createElement("div");
    body.className = "section-body";
    sec.append(h, body);
    sectionsEl.appendChild(sec);
    return body;
  }

  // The macro layer: five expressive axes over the engine's real
  // parameters. Moving an engine macro exits the authored cycle (the app
  // does that - the panel only reports); ATMOSPHERE shapes the visual alone.
  const motionBody = section("MOTION", "motion", true);
  for (const name of MACRO_ORDER) {
    const macroName: MacroName = name;
    addSlider(
      motionBody,
      MACRO_LABELS[macroName],
      { min: 0, max: 1, step: 0.01 },
      () => opts.macros[macroName],
      (v) => {
        macros[macroName] = v;
        callbacks.onMacro(macroName);
      },
      (v) => v.toFixed(2),
      true,
      MACRO_TIPS[macroName]
    );
  }

  const memBody = section("MEMORY", "memory");
  addToggle(
    memBody,
    "Cycle",
    () => memory.active && memory.auto,
    (v) => {
      memory.active = v;
      memory.auto = v;
      callbacks.onToggleCycle();
    },
    "AUTHORED",
    "MANUAL",
    "AUTHORED runs the memory cycle; MANUAL hands the parameters to you."
  );
  addObjSlider(memBody, "Memory", params.memory, "strength", 0, 20, 0.1, (v) => v.toFixed(1), "How strongly particles try to return to their source.");
  addObjSlider(memBody, "Decay", params.memory, "decay", 0, 3, 0.01, num, "How quickly individual particles forget.");
  addObjSlider(memBody, "Reconstruction", params.memory, "reconstructionEase", 0.5, 4, 0.05, num, "How the pull eases with distance.");
  densityControls(memBody);

  const lifeBody = section("LIFE", "life");
  addObjSlider(lifeBody, "Attraction", params.life, "attraction", 0, 2, 0.01, num, "How strongly compatible particles gather.");
  addObjSlider(lifeBody, "Repulsion", params.life, "repulsion", 0, 2, 0.01, num, "How strongly particles push apart.");
  addObjSlider(lifeBody, "Radius", params.life, "interactionRadius", 0.2, 2, 0.01, num, "How far particles sense each other.");
  addObjSlider(lifeBody, "Force", params.life, "forceScale", 0, 14, 0.1, (v) => v.toFixed(1), "Overall strength of the life forces.");
  addObjSlider(lifeBody, "Chaos", params.life, "chaos", 0, 1, 0.01, num, "Controlled instability in the organism.");
  addObjSlider(lifeBody, "Friction", params.life, "friction", 0.5, 0.98, 0.005, (v) => v.toFixed(3), "How quickly movement settles.");
  addObjSlider(lifeBody, "Core", params.life, "coreRadius", 0.1, 0.5, 0.01, num, "The personal space around each particle.");
  addToggle(lifeBody, "Life", () => params.lifecycle.enabled, (v) => (params.lifecycle.enabled = v), "ON", "OFF", "Particles are born from the memory, grow, age and dissipate.");
  addObjSlider(lifeBody, "Lifespan", params.lifecycle, "lifespan", 8, 180, 1, (v) => `${v.toFixed(0)}s`, "How long one particle lives before it returns to the source.");
  addObjSlider(lifeBody, "Spread", params.lifecycle, "spread", 0, 1, 0.05, num, "How far births are staggered, so the swarm never dies at once.");
  speciesControls(lifeBody);
  kernelControls(lifeBody);

  const fieldBody = section("FIELD", "field");
  addObjSlider(fieldBody, "Turbulence", params, "turbulence", 0, 1, 0.01, num, "Curl noise stirring the field.");
  addObjSlider(fieldBody, "Wander", params, "wander", 0, 0.3, 0.005, num, "Smooth organic drift.");
  addObjSlider(fieldBody, "Drift", params, "drift", -1, 1, 0.01, num, "A constant current through the space.");
  addObjSlider(fieldBody, "Gravity", params, "gravity", -2, 2, 0.01, num, "A steady downward pull.");
  handControls(fieldBody);

  const scentBody = section("SCENT & HEAT", "heat");
  addToggle(scentBody, "Scent", () => params.scent.enabled, (v) => (params.scent.enabled = v), "ON", "OFF", "Leaves a fading trace of where the organism has been.");
  addObjSlider(scentBody, "Scent steer", params.scent, "steer", 0, 5, 0.05, num, "How strongly particles follow the scent.");
  addObjSlider(scentBody, "Scent deposit", params.scent, "deposit", 0, 2, 0.01, num, "How much scent each particle leaves.");
  addObjSlider(scentBody, "Scent fade", params.scent, "decay", 0.02, 0.95, 0.01, num, "How long past traces survive.");
  addToggle(scentBody, "Heat", () => params.heat.enabled, (v) => (params.heat.enabled = v), "ON", "OFF", "A second memory: warmth left where the swarm moves.");
  addObjSlider(scentBody, "Heat deposit", params.heat, "deposit", 0, 2, 0.02, num, "How much warmth each particle leaves behind.");
  addObjSlider(scentBody, "Heat decay", params.heat, "decay", 0.02, 0.95, 0.01, num, "How quickly the warmth cools away.");
  addObjSlider(scentBody, "Heat steer", params.heat, "steer", -2, 2, 0.05, num, "Negative flees the warmth, positive seeks it.");

  const ecoBody = section("ECOLOGY", "ecology");
  addToggle(
    ecoBody,
    "Ecology",
    () => ecology.enabled,
    (v) => {
      ecology.enabled = v;
      callbacks.onEcologyToggle();
    },
    "ON",
    "OFF",
    "Predation, birth and death. Species that hunt eat, starve, and reproduce."
  );
  addObjSlider(ecoBody, "Reach", ecology, "captureRadius", 0.2, 3, 0.05, num, "How close a hunt has to get before it can succeed.");
  addObjSlider(ecoBody, "Kill", ecology, "killChance", 0, 3, 0.05, num, "How likely a hunt in range is to succeed.");
  addObjSlider(ecoBody, "Starve", ecology, "starveSeconds", 2, 60, 1, (v) => `${v.toFixed(0)}s`, "How long a hunter can go without a meal.");
  addObjSlider(ecoBody, "Age risk", ecology, "ageRisk", 0, 0.4, 0.005, (v) => v.toFixed(3), "Per-second mortality for spent particles.");
  addObjSlider(ecoBody, "Reproduce", ecology, "reproductionSatiation", 0.3, 3, 0.05, num, "How well fed a particle must be to leave offspring.");
  addToggle(
    ecoBody,
    "Sound",
    () => ecology.audioReactive,
    (v) => {
      ecology.audioReactive = v;
    },
    "ON",
    "OFF",
    "Let the room drive the ecology: loud is hungry, low end breeds, a transient startles."
  );
  {
    const readout = addNote(ecoBody, "");
    addNote(ecoBody, "CPU BACKEND ONLY - SWITCH IN THE LAB");
    syncFns.push(() => {
      readout.textContent = `+ ${ecologyEvents.births} BORN   - ${ecologyEvents.deaths} DIED`;
    });
  }

  const visBody = section("VISUAL", "visual");
  addObjSlider(visBody, "Size", visual, "particleSize", 0.4, 4, 0.05, num);
  addObjSlider(visBody, "Glow", visual, "glow", 0, 2, 0.05, num);
  addObjSlider(visBody, "Opacity", visual, "opacity", 0.05, 1, 0.01, num);
  addObjSlider(visBody, "Depth", visual, "dof", 0, 1, 0.01, num, "Depth-of-field focus falloff.");
  addObjSlider(visBody, "Fog", visual, "fogDensity", 0, 0.12, 0.002, (v) => v.toFixed(3));
  trailControls(visBody);
  colorControls(visBody);
  shapeControls(visBody);

  const soundBody = section("SOUND", "sound");
  soundControls(soundBody);
  addNote(soundBody, "AUDIO STAYS IN THIS TAB - ANALYSED AND SYNTHESISED LOCALLY");

  const evolveBody = section("EVOLVE", "evolve");
  addToggle(
    evolveBody,
    "Evolve",
    () => evolve.enabled,
    (v) => {
      evolve.enabled = v;
      callbacks.onEvolveToggle();
    },
    "ON",
    "OFF",
    "VOID searches its own species matrices and keeps what remembers better."
  );
  addObjSlider(evolveBody, "Trial", evolve, "trialSeconds", 2, 20, 0.5, (v) => `${v.toFixed(1)}s`, "How long each candidate gets to prove itself.");
  addObjSlider(evolveBody, "Mutation", evolve, "mutation", 0.02, 1, 0.01, num, "How far each child drifts from its parents.");
  addToggle(
    evolveBody,
    "Look",
    () => evolve.phenotype,
    (v) => {
      evolve.phenotype = v;
    },
    "ON",
    "OFF",
    "Let the search evolve each species' hue and shape alongside its behaviour. Appearance cannot be scored, so it rides the winner."
  );
  addToggle(
    evolveBody,
    "Ecology",
    () => evolve.ecology,
    (v) => {
      evolve.ecology = v;
    },
    "ON",
    "OFF",
    "Let the search evolve the ecology too: how far a hunt reaches, how deadly it is, who starves. Scored through the population."
  );
  evolveReadout = addNote(evolveBody, "IDLE");

  // THE LAB: how the piece runs rather than what it is.
  const labBody = section("LAB", "lab");
  {
    const simBtn = document.createElement("button");
    simBtn.className = "act sim";
    simBtn.title = "Switch the simulation backend. The GPU path is the showpiece; the CPU path is where the ecology lives.";
    simBtn.addEventListener("click", () => callbacks.onBackendToggle());
    labBody.appendChild(simBtn);
    const paintSim = () => {
      simBtn.textContent = `SIM: ${backend().toUpperCase()}`;
    };
    paintSim();
    syncFns.push(paintSim);
  }
  addToggle(labBody, "Ghost", () => pointer.ghost, (v) => (pointer.ghost = v), "ON", "OFF", "Replay the hand VOID recorded while the screensaver runs.");
  addObjSlider(labBody, "Sync", params, "phaseCoupling", 0, 4, 0.05, num, "Couples particle rhythms into a shared heartbeat.");
  addObjSlider(labBody, "Scent affinity", params.environment, "scent", -2, 2, 0.05, num, "How much its own trail makes the swarm stickier (negative: looser).");
  addObjSlider(labBody, "Heat affinity", params.environment, "heat", -2, 2, 0.05, num, "How much its own warmth makes the swarm stickier (negative: looser).");
  {
    const reset = document.createElement("button");
    reset.className = "act";
    reset.textContent = "RESET LAYOUT";
    reset.title = "Bring back every panel where it started.";
    reset.addEventListener("click", () => {
      for (const k of Object.keys(layout) as StudioPanel[]) setPanelOpen(k, true);
    });
    labBody.appendChild(reset);
  }
  const stats = document.createElement("div");
  stats.id = "panel-stats";
  stats.textContent = "-";
  labBody.appendChild(stats);

  const footer = document.createElement("div");
  footer.id = "panel-footer";
  const credit = document.createElement("div");
  credit.className = "credit";
  credit.innerHTML =
    '<a href="https://mehran-ahmadi.com/" target="_blank" rel="noopener">DEVELOPED BY MEHRAN AHMADI © 2026</a>';
  credit.append(` · v${__APP_VERSION__}`);
  footer.append(credit);
  panel.appendChild(footer);

  // --- LOOKS DOCK --------------------------------------------------------------
  const looks = document.createElement("div");
  looks.id = "void-looks";
  looks.setAttribute("aria-label", "Looks");
  studio.appendChild(looks);
  const looksHead = document.createElement("div");
  looksHead.className = "looks-head";
  const looksTitle = document.createElement("span");
  looksTitle.className = "looks-title";
  looksTitle.textContent = "LOOKS";
  const looksClose = document.createElement("button");
  looksClose.className = "close";
  looksClose.setAttribute("aria-label", "Close looks");
  looksClose.appendChild(icon("close", 14));
  looksClose.addEventListener("click", () => setPanelOpen("looks", false));
  looksHead.append(looksTitle, looksClose);
  looks.appendChild(looksHead);

  const looksRow = document.createElement("div");
  looksRow.className = "looks-row";
  looks.appendChild(looksRow);
  const presetGrid = document.createElement("div");
  presetGrid.className = "preset-grid";
  looksRow.appendChild(presetGrid);

  // Each look as a face: a static thumbnail (captured once from a fixed seed,
  // shipped in public/presets/), or - for a look without one - its own
  // palette as light. Static on purpose: a dozen live simulations to fill a
  // browser would work against every performance budget the piece keeps.
  const presetBtns = new Map<string, HTMLButtonElement>();
  for (const def of PRESET_DEFINITIONS) {
    const card = document.createElement("button");
    card.className = "preset-card";
    card.dataset.preset = def.name;
    if (def.witness) card.classList.add("witness");
    card.title = def.description;
    const face = document.createElement("span");
    face.className = "preset-face";
    face.style.background = presetSwatchCss(def);
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = `${import.meta.env.BASE_URL}presets/${def.name}.png`;
    img.addEventListener("error", () => img.remove());
    face.appendChild(img);
    if (def.witness) face.appendChild(icon("witness", 16));
    const label = document.createElement("span");
    label.className = "preset-name";
    label.textContent = def.label.toUpperCase();
    card.append(face, label);
    card.setAttribute("aria-label", `${def.label}: ${def.description}`);
    card.addEventListener("click", () => callbacks.onPreset(def.name));
    presetGrid.appendChild(card);
    presetBtns.set(def.name, card);
  }

  const looksActions = document.createElement("div");
  looksActions.className = "looks-actions";
  looksRow.appendChild(looksActions);
  iconBtn(looksActions, "randomize", "random", "RANDOM", () => callbacks.onRandomize(), "A brand-new organism (undo is always there)");
  iconBtn(looksActions, "undo", "undo", "UNDO", () => callbacks.onUndo(), "Go back one step");
  iconBtn(looksActions, "reset", "reset", "RESET", () => callbacks.onReset(), "Back to the beginning");

  studio.appendChild(status);

  // --- Window management -------------------------------------------------------
  const touchPrimary =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  // A touch-primary device starts with the piece first: the tools and the
  // properties wait behind their top-bar toggles; the looks stay in reach.
  const layout: Layout = loadLayout({ tools: !touchPrimary, props: !touchPrimary, looks: true });
  const panelEls: Record<StudioPanel, HTMLElement> = { tools, props: panel, looks };
  const windowBtns = new Map<StudioPanel, HTMLButtonElement>();
  windowBtns.set("tools", iconBtn(windows, "window-tools", "panelLeft", "TOOLS", () => setPanelOpen("tools", !layout.tools), "Show or hide the tools"));
  windowBtns.set("props", iconBtn(windows, "window-props", "panelRight", "PANEL", () => setPanelOpen("props", !layout.props), "Show or hide the properties"));
  windowBtns.set("looks", iconBtn(windows, "window-looks", "panelBottom", "LOOKS", () => setPanelOpen("looks", !layout.looks), "Show or hide the looks"));
  iconBtn(windows, "help", "help", "HELP", () => callbacks.onToggleGuide(), "Controls guide (?)");
  const hideBtn = iconBtn(windows, "hide", "hideUi", "HIDE", () => setStudioVisible(false), "Hide everything - just the piece (P)");
  hideBtn.classList.add("panel-toggle");

  function setPanelOpen(which: StudioPanel, open: boolean): void {
    layout[which] = open;
    panelEls[which].hidden = !open;
    windowBtns.get(which)?.classList.toggle("on", open);
    windowBtns.get(which)?.setAttribute("aria-pressed", String(open));
    studio.classList.toggle(`no-${which}`, !open);
    if (which === "tools" && !open) setTool(null);
    saveLayout(layout);
  }
  for (const k of Object.keys(layout) as StudioPanel[]) setPanelOpen(k, layout[k]);

  const showPanelBtn = document.createElement("button");
  showPanelBtn.id = "panel-toggle-btn";
  showPanelBtn.setAttribute("aria-label", "Show the studio");
  showPanelBtn.append(icon("layout", 16), document.createTextNode("STUDIO"));
  showPanelBtn.style.display = "none";
  showPanelBtn.addEventListener("click", () => setStudioVisible(true));
  document.body.appendChild(showPanelBtn);

  let studioVisible = true;
  function setStudioVisible(visible: boolean): void {
    studioVisible = visible;
    studio.classList.toggle("stowed", !visible);
    showPanelBtn.style.display = visible ? "none" : "flex";
    if (!visible) setTool(null);
  }

  syncAll();

  return {
    element: studio,
    setSourceInfo(name, kind, detail, count) {
      // The chip is the door: what VOID remembers, and the tap that changes it.
      sourceChip.textContent = `${name} · ${count.toLocaleString()}`;
      sourceChip.title = `${kind.toUpperCase()} · ${detail} · tap to change`;
    },
    setCount(count) {
      currentCount = count;
      syncAll();
    },
    setActivePreset(name) {
      for (const [pname, btn] of presetBtns) {
        btn.classList.toggle("on", pname === name);
        btn.setAttribute("aria-pressed", String(pname === name));
      }
      moon.classList.toggle("on", name === "moon");
    },
    setPaused(paused) {
      const lbl = pauseBtn.querySelector(".lbl");
      if (lbl) lbl.textContent = paused ? "PLAY" : "PAUSE";
      pauseBtn.querySelector("svg")?.replaceWith(icon(paused ? "play" : "pause"));
      pauseBtn.classList.toggle("on", paused);
    },
    setState(name) {
      stateChip.textContent = name;
    },
    setStats(text) {
      stats.textContent = text;
    },
    setHint(text, seconds, sticky) {
      showStatus(text, sticky ? 0 : seconds, sticky ? "error" : "");
    },
    clearHint() {
      showStatus("", 0);
    },
    setEvolve(text) {
      if (evolveReadout) evolveReadout.textContent = text;
    },
    toggleVisible() {
      setStudioVisible(!studioVisible);
    },
    refresh() {
      syncAll();
    },
  };
}
