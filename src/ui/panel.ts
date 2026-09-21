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
import { GRADIENT_PALETTE_NAMES } from "@/rendering/palette";
import type { MemorySystem } from "@/memory/MemorySystem";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { PRESET_DEFINITIONS } from "@/presets/presets";
import {
  MACRO_LABELS,
  MACRO_ORDER,
  MACRO_TIPS,
  type MacroName,
  type MacroValues,
} from "@/presets/macros";
import "./panel.css";

/**
 * The control panel (v0.9.0 IA): three tiers, by consequence.
 *
 * Tier 1 — THE PIECE. Always visible: the source chip, the density, the two
 * great gestures (RECONSTRUCT / RELEASE), the direct SOURCE action, the
 * screensaver and fullscreen, and the doors to what lies beneath.
 *
 * Tier 2 — THE INSTRUMENT. An accordion, closed by default, one section open
 * at a time: MOTION (the macro layer), MEMORY, LIFE, FIELD, SCENT & HEAT,
 * ECOLOGY, VISUAL, SOUND, EVOLVE, and the PRESETS / ACTIONS sections. The
 * piece's whole identity is withhold-and-reveal; the instrument hides
 * behind discovery, not confusion.
 *
 * Tier 3 — THE LAB. Behind one explicit door: the backend switch, the ghost
 * replay, the quiet modulators (sync, the environment affinities), and the
 * stats. The controls about how the piece runs rather than what it is.
 *
 * Built from declarative slider specs so adding a parameter later is one
 * line. Nothing about behaviour is hard-coded in the UI, and every
 * underlying mechanic is exactly where it was — this is a regrouping, not a
 * re-parameterisation.
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
  /** Called when a change needs the particle buffers re-baked (colour/shape). */
  onLookChange?: () => void;
}): PanelApi {
  const { params, visual, memory, callbacks, sound, evolve, pointer, soundscape, ecology, ecologyEvents, onLookChange, backend, macros } = opts;
  let speciesCount = opts.speciesCount;
  let currentCount = opts.currentCount;

  const panel = document.createElement("div");
  panel.id = "panel";

  const syncFns: Array<() => void> = [];
  let evolveReadout: HTMLElement | null = null;

  // The status line exists before the sections do: rows show their meaning
  // here on a press-and-hold, because a title attribute is invisible to
  // touch.
  const status = document.createElement("div");
  status.id = "panel-status";
  let tipTimer = 0;
  function showTip(text: string): void {
    status.textContent = text;
    status.classList.add("tip");
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      status.textContent = "";
      status.classList.remove("tip");
    }, 2600);
  }

  /** Press-and-hold the row's label and its meaning appears in the status. */
  function attachTip(row: HTMLElement, tip: string): void {
    let hold = 0;
    const label = row.querySelector("label");
    if (!label) return;
    label.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return; // hover already has the title
      hold = window.setTimeout(() => showTip(tip), 350);
    });
    const cancel = () => window.clearTimeout(hold);
    label.addEventListener("pointerup", cancel);
    label.addEventListener("pointercancel", cancel);
    label.addEventListener("pointerleave", cancel);
  }

  const mkBtn = (parent: HTMLElement, label: string, fn: () => void, primary = false): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = primary ? "act primary" : "act";
    b.textContent = label;
    b.addEventListener("click", fn);
    parent.appendChild(b);
    return b;
  };

  function section(title: string, parent: HTMLElement, accordion: boolean): HTMLElement {
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = title;
    const body = document.createElement("div");
    body.className = "section-body";
    sec.append(h, body);
    if (accordion) {
      // Closed by default; opening one section closes the others. The wall
      // of controls becomes a table of contents.
      sec.classList.add("closed");
      h.addEventListener("click", () => {
        const opening = sec.classList.contains("closed");
        for (const s of tier2.querySelectorAll("section")) s.classList.add("closed");
        if (opening) sec.classList.remove("closed");
      });
    } else {
      h.addEventListener("click", () => sec.classList.toggle("closed"));
    }
    parent.appendChild(sec);
    return body;
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
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = format(get());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      val.textContent = format(v);
      if (live) callbacks.onUserInteraction();
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
    btn.className = "act";
    const paint = () => {
      const on = get();
      btn.textContent = on ? onLabel : offLabel;
      btn.classList.toggle("on", on);
    };
    btn.addEventListener("click", () => {
      set(!get());
      paint();
      callbacks.onUserInteraction();
    });
    paint();
    row.append(lbl, btn);
    body.appendChild(row);
    if (tip) attachTip(row, tip);
    syncFns.push(paint);
  }

  /**
   * A one-of-N row: a label plus a grid of buttons, one selected at a time.
   * `visible` hides the whole row when the choice does not apply yet (the
   * gradient axis only means something once COLOR is GRADIENT).
   */
  function addChoiceRow(
    body: HTMLElement,
    label: string,
    options: readonly string[],
    current: () => string,
    choose: (value: string) => void,
    tip?: string,
    visible?: () => boolean
  ): void {
    const row = document.createElement("div");
    row.className = "row";
    if (tip) row.title = tip;
    const lbl = document.createElement("label");
    lbl.textContent = label;
    const grid = document.createElement("div");
    grid.className = "btn-grid";
    const buttons = new Map<string, HTMLButtonElement>();
    for (const option of options) {
      const b = document.createElement("button");
      b.className = "act";
      b.textContent = option.toUpperCase();
      b.addEventListener("click", () => {
        if (current() === option) return;
        choose(option);
        paint();
        callbacks.onUserInteraction();
      });
      buttons.set(option, b);
      grid.appendChild(b);
    }
    function paint(): void {
      const active = current();
      for (const [option, b] of buttons) b.classList.toggle("on", option === active);
      if (visible) row.style.display = visible() ? "" : "none";
    }
    paint();
    syncFns.push(paint);
    row.append(lbl, grid);
    body.appendChild(row);
    if (tip) attachTip(row, tip);
  }

  // --- TIER 1: THE PIECE -----------------------------------------------------
  const tier1 = document.createElement("div");
  tier1.className = "panel-tier1";
  panel.appendChild(tier1);

  // The source chip: what VOID remembers, and the door to change it.
  const sourceChip = document.createElement("button");
  sourceChip.id = "panel-source-chip";
  sourceChip.addEventListener("click", () => callbacks.onAddSource());
  tier1.appendChild(sourceChip);

  addSlider(
    tier1,
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

  // The PAUSE action's label is driven from the app via api.setPaused.
  let pauseStateSetter: ((paused: boolean) => void) | null = null;
  // The signature look: one prominent action, never a nested menu. A moon
  // crescent with a visible label and a spoken label (the accessible name
  // carries the description the tooltip would).
  {
    const moonBtn = document.createElement("button");
    moonBtn.className = "act moon";
    moonBtn.setAttribute("aria-label", "Moon Dust, the signature look: ripples under your hand, luminous trails, and a swarm that comes home");
    moonBtn.title = "Moon Dust — the signature look";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z");
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    const label = document.createElement("span");
    label.textContent = "MOON DUST";
    moonBtn.append(svg, label);
    moonBtn.addEventListener("click", () => callbacks.onPreset("moon"));
    tier1.appendChild(moonBtn);
  }

  {
    const grid = document.createElement("div");
    grid.className = "btn-grid";
    mkBtn(grid, "RECONSTRUCT", () => callbacks.onReconstruct(), true);
    mkBtn(grid, "RELEASE", () => callbacks.onRelease(), true);
    // Simulation pause, distinct from the screensaver and the memory
    // cycle: steps stop, the camera and trails keep breathing.
    const pauseBtn = mkBtn(grid, "PAUSE", () => callbacks.onTogglePause());
    mkBtn(grid, "CAPTURE", () => callbacks.onCapture());
    mkBtn(grid, "SOURCE", () => callbacks.onAddSource());
    mkBtn(grid, "SCREENSAVER", () => callbacks.onScreensaver());
    mkBtn(grid, "FULLSCREEN", () => callbacks.onFullscreen());
    tier1.appendChild(grid);
    pauseStateSetter = (paused: boolean) => {
      pauseBtn.textContent = paused ? "PLAY" : "PAUSE";
      pauseBtn.classList.toggle("on", paused);
    };
  }

  const doors = document.createElement("div");
  doors.className = "btn-grid panel-doors";
  tier1.appendChild(doors);

  // --- TIER 2: THE INSTRUMENT ------------------------------------------------
  const tier2 = document.createElement("div");
  tier2.className = "panel-tier2";
  tier2.style.display = "none";
  panel.appendChild(tier2);

  // The macro layer: five expressive axes over the engine's real
  // parameters. Moving an engine macro exits the authored cycle (the app
  // does that — the panel only reports); ATMOSPHERE shapes the visual
  // alone and composes with the cycle.
  const motionBody = section("MOTION", tier2, true);
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

  const memBody = section("MEMORY", tier2, true);
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

  const lifeBody = section("LIFE", tier2, true);
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
  {
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
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = String(speciesCount);
    input.addEventListener("change", () => {
      speciesCount = Number(input.value);
      val.textContent = String(speciesCount);
      callbacks.onSpeciesChange(speciesCount);
    });
    row.append(label, input, val);
    lifeBody.appendChild(row);
    attachTip(row, "How many species share the memory.");
    syncFns.push(() => {
      input.value = String(speciesCount);
      val.textContent = String(speciesCount);
    });
  }
  {
    const row = document.createElement("div");
    row.className = "row";
    row.title = "The shape of the force between particles.";
    const label = document.createElement("label");
    label.textContent = "Kernel";
    const select = document.createElement("select");
    for (const k of ["pulse", "inverse", "linear"]) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k.toUpperCase();
      select.appendChild(opt);
    }
    select.value = params.life.kernel;
    select.addEventListener("change", () => {
      params.life.kernel = select.value as typeof params.life.kernel;
      callbacks.onUserInteraction();
    });
    row.append(label, select);
    lifeBody.appendChild(row);
    attachTip(row, "The shape of the force between particles.");
    syncFns.push(() => {
      select.value = params.life.kernel;
    });
  }

  const fieldBody = section("FIELD", tier2, true);
  addObjSlider(fieldBody, "Turbulence", params, "turbulence", 0, 1, 0.01, num, "Curl noise stirring the field.");
  addObjSlider(fieldBody, "Wander", params, "wander", 0, 0.3, 0.005, num, "Smooth organic drift.");
  addObjSlider(fieldBody, "Drift", params, "drift", -1, 1, 0.01, num, "A constant current through the space.");
  addObjSlider(fieldBody, "Gravity", params, "gravity", -2, 2, 0.01, num, "A steady downward pull.");
  addObjSlider(fieldBody, "Cursor", pointer, "strength", 0, 3, 0.05, num, "How strongly the swarm leans toward your pointer.");
  addToggle(fieldBody, "Cursor", () => pointer.mode > 0, (v) => (pointer.mode = v ? 1 : -1), "PULL", "PUSH", "Attract to the pointer, or push away from it.");

  const scentBody = section("SCENT & HEAT", tier2, true);
  addToggle(scentBody, "Scent", () => params.scent.enabled, (v) => (params.scent.enabled = v), "ON", "OFF", "Leaves a fading trace of where the organism has been.");
  addObjSlider(scentBody, "Scent steer", params.scent, "steer", 0, 5, 0.05, num, "How strongly particles follow the scent.");
  addObjSlider(scentBody, "Scent deposit", params.scent, "deposit", 0, 2, 0.01, num, "How much scent each particle leaves.");
  addObjSlider(scentBody, "Scent fade", params.scent, "decay", 0.02, 0.95, 0.01, num, "How long past traces survive.");
  addToggle(scentBody, "Heat", () => params.heat.enabled, (v) => (params.heat.enabled = v), "ON", "OFF", "A second memory: warmth left where the swarm moves.");
  addObjSlider(scentBody, "Heat deposit", params.heat, "deposit", 0, 2, 0.02, num, "How much warmth each particle leaves behind.");
  addObjSlider(scentBody, "Heat decay", params.heat, "decay", 0.02, 0.95, 0.01, num, "How quickly the warmth cools away.");
  addObjSlider(scentBody, "Heat steer", params.heat, "steer", -2, 2, 0.05, num, "Negative flees the warmth, positive seeks it.");

  const ecoBody = section("ECOLOGY", tier2, true);
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
    const readout = document.createElement("div");
    readout.className = "meta";
    const note = document.createElement("div");
    note.className = "meta";
    note.textContent = "CPU BACKEND ONLY - SWITCH IN THE LAB";
    ecoBody.append(readout, note);
    syncFns.push(() => {
      readout.textContent = `+ ${ecologyEvents.births} BORN   - ${ecologyEvents.deaths} DIED`;
    });
  }

  const visBody = section("VISUAL", tier2, true);
  addObjSlider(visBody, "Size", visual, "particleSize", 0.4, 4, 0.05, num);
  addObjSlider(visBody, "Glow", visual, "glow", 0, 2, 0.05, num);
  addObjSlider(visBody, "Opacity", visual, "opacity", 0.05, 1, 0.01, num);
  addObjSlider(visBody, "Depth", visual, "dof", 0, 1, 0.01, num, "Depth-of-field focus falloff.");
  addObjSlider(visBody, "Fog", visual, "fogDensity", 0, 0.12, 0.002, (v) => v.toFixed(3));
  addObjSlider(visBody, "Trail", visual, "trailDecay", 0.2, 0.95, 0.01, num, "How long the afterimage lingers.");
  addToggle(visBody, "Trails", () => visual.trails, (v) => (visual.trails = v), "ON", "OFF", "Afterimage of where the organism has been.");
  // Colour source: genuinely different looks, not filters over one base.
  addChoiceRow(
    visBody,
    "Color",
    COLOR_MODES,
    () => visual.colorMode,
    (v) => {
      visual.colorMode = v as ColorMode;
      onLookChange?.();
    },
    "Monochrome, the source's own colors, one hue per species, a seeded hue per particle, or an authored ramp."
  );
  addChoiceRow(
    visBody,
    "Axis",
    GRADIENT_AXES,
    () => visual.gradientAxis,
    (v) => {
      visual.gradientAxis = v as GradientAxis;
      onLookChange?.();
    },
    "What the ramp is mapped across: a particle's own life cycle, or its distance from the camera.",
    () => visual.colorMode === "gradient"
  );
  addChoiceRow(
    visBody,
    "Ramp",
    GRADIENT_PALETTE_NAMES,
    () => visual.gradientPalette,
    (v) => {
      visual.gradientPalette = v;
      onLookChange?.();
    },
    "Authored gradient palettes.",
    () => visual.colorMode === "gradient"
  );
  addChoiceRow(
    visBody,
    "Shape",
    PARTICLE_SHAPES,
    () => visual.shape,
    (v) => {
      visual.shape = v as ParticleShape;
      visual.shapeBySpecies = false;
      onLookChange?.();
    },
    "Sprite shape, drawn analytically — no textures, no extra geometry."
  );
  addToggle(
    visBody,
    "By species",
    () => visual.shapeBySpecies,
    (v) => {
      visual.shapeBySpecies = v;
      onLookChange?.();
    },
    "ON",
    "OFF",
    "Give each species its own shape, so the ecosystem reads at a glance."
  );

  const soundBody = section("SOUND", tier2, true);
  addToggle(
    soundBody,
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
  addObjSlider(soundBody, "Sensitivity", sound, "sensitivity", 0.2, 3, 0.05, num, "How strongly sound moves the swarm.");
  {
    const row = document.createElement("div");
    row.className = "row";
    row.title = "Where the sound comes from: your microphone, or the audio of a tab you share.";
    const label = document.createElement("label");
    label.textContent = "Input";
    const select = document.createElement("select");
    for (const option of [{ value: "mic", text: "MICROPHONE" }, { value: "tab", text: "TAB AUDIO" }]) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.text;
      select.appendChild(opt);
    }
    select.value = sound.source;
    select.addEventListener("change", () => {
      sound.source = select.value as AudioSource;
      callbacks.onSoundSourceChange();
    });
    row.append(label, select);
    soundBody.appendChild(row);
    syncFns.push(() => {
      select.value = sound.source;
    });
  }
  addToggle(
    soundBody,
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
  addObjSlider(soundBody, "Volume", soundscape, "volume", 0, 1, 0.01, num, "How loud the soundscape is.");
  {
    const note = document.createElement("div");
    note.className = "meta";
    note.textContent = "AUDIO STAYS IN THIS TAB - ANALYSED AND SYNTHESISED LOCALLY";
    soundBody.appendChild(note);
  }

  const evolveBody = section("EVOLVE", tier2, true);
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
  {
    const readout = document.createElement("div");
    readout.className = "meta";
    readout.textContent = "IDLE";
    evolveBody.appendChild(readout);
    evolveReadout = readout;
  }

  // The looks browser: each look as a face — a static thumbnail (captured
  // once from a fixed seed, shipped in public/presets/), its name, and its
  // one-line description. A look with no thumbnail falls back to the word.
  // Static images on purpose: twelve live simulations to populate a browser
  // would work against every performance budget the piece keeps.
  const presetBody = section("PRESETS", tier2, true);
  const presetGrid = document.createElement("div");
  presetGrid.className = "preset-grid";
  const presetBtns = new Map<string, HTMLButtonElement>();
  for (const def of PRESET_DEFINITIONS) {
    const card = document.createElement("button");
    card.className = "preset-card";
    card.title = def.description;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = `${def.label} look`;
    img.src = `${import.meta.env.BASE_URL}presets/${def.name}.png`;
    img.addEventListener("error", () => img.remove());
    const label = document.createElement("span");
    label.className = "preset-name";
    label.textContent = def.label.toUpperCase();
    const desc = document.createElement("span");
    desc.className = "preset-desc";
    desc.textContent = def.description;
    card.append(img, label, desc);
    card.addEventListener("click", () => callbacks.onPreset(def.name));
    presetGrid.appendChild(card);
    presetBtns.set(def.name, card);
  }
  presetBody.appendChild(presetGrid);
  syncFns.push(() => {
    for (const btn of presetBtns.values()) btn.classList.remove("on");
  });

  const actBody = section("ACTIONS", tier2, true);
  const actGrid = document.createElement("div");
  actGrid.className = "btn-grid";
  mkBtn(actGrid, "RANDOMIZE", () => callbacks.onRandomize());
  mkBtn(actGrid, "UNDO", () => callbacks.onUndo());
  mkBtn(actGrid, "RESET", () => callbacks.onReset());
  actBody.appendChild(actGrid);

  // --- TIER 3: THE LAB ---------------------------------------------------------
  const tier3 = document.createElement("div");
  tier3.className = "panel-tier3";
  tier3.style.display = "none";
  {
    const label = document.createElement("div");
    label.className = "lab-title";
    label.textContent = "THE LAB";
    tier3.appendChild(label);
  }
  panel.appendChild(tier3);

  {
    const simBtn = document.createElement("button");
    simBtn.className = "act sim";
    simBtn.title = "Switch the simulation backend. The GPU path is the showpiece; the CPU path is where the ecology lives.";
    simBtn.addEventListener("click", () => callbacks.onBackendToggle());
    tier3.appendChild(simBtn);
    const paintSim = () => {
      simBtn.textContent = `SIM: ${backend().toUpperCase()}`;
    };
    paintSim();
    syncFns.push(paintSim);
  }
  addToggle(
    tier3,
    "Ghost",
    () => pointer.ghost,
    (v) => (pointer.ghost = v),
    "ON",
    "OFF",
    "Replay the hand VOID recorded while the screensaver runs."
  );
  addObjSlider(tier3, "Sync", params, "phaseCoupling", 0, 4, 0.05, num, "Couples particle rhythms into a shared heartbeat.");
  addObjSlider(tier3, "Scent affinity", params.environment, "scent", -2, 2, 0.05, num, "How much its own trail makes the swarm stickier (negative: looser).");
  addObjSlider(tier3, "Heat affinity", params.environment, "heat", -2, 2, 0.05, num, "How much its own warmth makes the swarm stickier (negative: looser).");
  {
    const note = document.createElement("div");
    note.className = "meta";
    note.textContent = "THE QUIET MODULATORS, AND HOW THE PIECE RUNS.";
    tier3.appendChild(note);
  }
  const stats = document.createElement("div");
  stats.id = "panel-stats";
  stats.textContent = "—";
  tier3.appendChild(stats);

  // --- Footer ----------------------------------------------------------------
  const footer = document.createElement("div");
  footer.id = "panel-footer";
  const credit = document.createElement("div");
  credit.className = "credit";
  // Credit, with the version the app was built from (package.json).
  credit.innerHTML =
    '<a href="https://mehran-ahmadi.com/" target="_blank" rel="noopener">DEVELOPED BY MEHRAN AHMADI \u00a9 2026</a>';
  credit.append(` \u00b7 v${__APP_VERSION__}`);
  footer.append(status, credit);
  panel.appendChild(footer);

  // Doors: the tier-1 buttons that open the instrument and the lab.
  let openTier: 2 | 3 | null = null;
  function setTier(tier: 2 | 3 | null): void {
    openTier = tier;
    tier2.style.display = tier === 2 ? "block" : "none";
    tier3.style.display = tier === 3 ? "block" : "none";
    for (const [door, t] of [
      [instrumentDoor, 2],
      [labDoor, 3],
    ] as const) {
      door.classList.toggle("on", tier === t);
    }
  }
  const instrumentDoor = mkBtn(doors, "INSTRUMENT", () => setTier(openTier === 2 ? null : 2));
  const labDoor = mkBtn(doors, "LAB", () => setTier(openTier === 3 ? null : 3));

  // Visibility toggle.
  const head = document.createElement("div");
  head.className = "panel-head";
  head.innerHTML =
    `<span class="brand"><img src="${import.meta.env.BASE_URL}icons/void-64.png" alt="" />VOID</span><span id="panel-state">RECONSTRUCT</span>`;
  const helpBtn = document.createElement("button");
  helpBtn.className = "panel-toggle";
  helpBtn.textContent = "?";
  helpBtn.title = "Controls guide (?)";
  helpBtn.addEventListener("click", () => callbacks.onToggleGuide());
  const hideBtn = document.createElement("button");
  hideBtn.className = "panel-toggle";
  hideBtn.textContent = "HIDE";
  head.appendChild(helpBtn);
  head.appendChild(hideBtn);
  panel.prepend(head);
  const showPanelBtn = document.createElement("button");
  showPanelBtn.id = "panel-toggle-btn";
  showPanelBtn.textContent = "PANEL";
  showPanelBtn.style.display = "none";
  const setPanelVisible = (visible: boolean) => {
    panel.style.display = visible ? "block" : "none";
    showPanelBtn.style.display = visible ? "none" : "block";
  };
  hideBtn.addEventListener("click", () => setPanelVisible(false));
  showPanelBtn.addEventListener("click", () => setPanelVisible(true));
  document.body.appendChild(showPanelBtn);
  // A touch-primary device starts with the panel stowed: the piece first,
  // the instrument behind its button. Desktop opens with the panel up, as
  // the instrument has always been.
  const touchPrimary =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  setPanelVisible(!touchPrimary);

  // Phone: the head is the sheet's handle — drag it down to stow the panel.
  // The drag is tracked at the window level, NOT with pointer capture:
  // capturing the head's pointer retargets the gesture to the head, and the
  // browser then fires the tap's click on the head instead of the ? and
  // HIDE buttons, which stopped working on real devices.
  let headDragY: number | null = null;
  let headDragId: number | null = null;
  head.addEventListener("pointerdown", (e) => {
    headDragY = e.clientY;
    headDragId = e.pointerId;
  });
  window.addEventListener("pointermove", (e) => {
    if (headDragY === null || headDragId !== e.pointerId) return;
    if (e.clientY - headDragY > 60) {
      headDragY = null;
      headDragId = null;
      setPanelVisible(false);
    }
  });
  const endHeadDrag = (e: PointerEvent) => {
    if (headDragId === null || headDragId === e.pointerId) {
      headDragY = null;
      headDragId = null;
    }
  };
  window.addEventListener("pointerup", endHeadDrag);
  window.addEventListener("pointercancel", endHeadDrag);

  return {
    element: panel,
    setSourceInfo(name, kind, detail, count) {
      // The chip is the door: what VOID remembers, and the tap that changes it.
      sourceChip.textContent = `${name} · ${count.toLocaleString()}`;
      sourceChip.title = `${kind.toUpperCase()} · ${detail} · tap to change`;
    },
    setCount(count) {
      currentCount = count;
    },
    setActivePreset(name) {
      for (const [pname, btn] of presetBtns) btn.classList.toggle("on", pname === name);
    },
    setPaused(paused) {
      pauseStateSetter?.(paused);
    },
    setState(name) {
      const el = document.getElementById("panel-state");
      if (el) el.textContent = name;
    },
    setStats(text) {
      stats.textContent = text;
    },
    setHint(text, seconds, sticky) {
      status.textContent = text;
      status.classList.toggle("error", sticky);
      status.classList.remove("tip");
      window.clearTimeout((status as unknown as { t?: number }).t);
      if (!sticky) {
        (status as unknown as { t?: number }).t = window.setTimeout(() => {
          status.textContent = "";
        }, seconds * 1000);
      }
    },
    clearHint() {
      status.textContent = "";
    },
    setEvolve(text) {
      if (evolveReadout) evolveReadout.textContent = text;
    },
    toggleVisible() {
      setPanelVisible(panel.style.display !== "none");
    },
    refresh() {
      for (const fn of syncFns) fn();
    },
  };
}
