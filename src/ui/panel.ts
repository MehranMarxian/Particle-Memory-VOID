import type { EngineParams } from "@/types";
import type { VisualSettings } from "@/rendering/VisualSettings";
import type { MemorySystem } from "@/memory/MemorySystem";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { PRESET_DEFINITIONS } from "@/presets/presets";
import "./panel.css";

/**
 * The control panel (spec §15): SOURCE / MEMORY / LIFE / FIELD / VISUAL /
 * PRESETS / ACTIONS. Built from declarative slider specs so adding a
 * parameter later is one line, and nothing about behavior is hard-coded
 * in the UI.
 */

export interface PanelCallbacks {
  onDensityChange(count: number): void;
  onAddSource(): void;
  onPreset(name: string): void;
  onRandomize(): void;
  onUndo(): void;
  onReset(): void;
  onReconstruct(): void;
  onRelease(): void;
  onFullscreen(): void;
  onSpeciesChange(n: number): void;
  onUserInteraction(): void;
  onToggleCycle(): void;
}

export interface PanelApi {
  readonly element: HTMLElement;
  setSourceInfo(name: string, kind: string, detail: string, count: number): void;
  setCount(count: number): void;
  setActivePreset(name: string | null): void;
  setState(name: string): void;
  setStats(text: string): void;
  setHint(text: string, seconds: number, sticky: boolean): void;
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
  callbacks: PanelCallbacks;
}): PanelApi {
  const { params, visual, memory, callbacks } = opts;
  let speciesCount = opts.speciesCount;
  let currentCount = opts.currentCount;

  const panel = document.createElement("div");
  panel.id = "panel";

  const syncFns: Array<() => void> = [];

  function section(title: string): HTMLElement {
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = title;
    h.addEventListener("click", () => sec.classList.toggle("closed"));
    const body = document.createElement("div");
    body.className = "section-body";
    sec.append(h, body);
    panel.appendChild(sec);
    return body;
  }

  function addSlider(
    body: HTMLElement,
    label: string,
    spec: { min: number; max: number; step: number },
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string,
    live: boolean
  ): void {
    const row = document.createElement("div");
    row.className = "row";
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
    format: (v: number) => string
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
      true
    );
  }

  function addToggle(
    body: HTMLElement,
    label: string,
    get: () => boolean,
    set: (v: boolean) => void,
    onLabel: string,
    offLabel: string
  ): void {
    const row = document.createElement("div");
    row.className = "row";
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
    syncFns.push(paint);
  }

  function addGridButton(body: HTMLElement, label: string, fn: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = primary ? "act primary" : "act";
    b.textContent = label;
    b.addEventListener("click", fn);
    body.appendChild(b);
    return b;
  }

  // --- SOURCE ---------------------------------------------------------------
  const sourceBody = section("SOURCE");
  const sourceMeta = document.createElement("div");
  sourceMeta.className = "meta";
  sourceBody.appendChild(sourceMeta);
  const addBtn = addGridButton(sourceBody, "ADD SOURCE", () => callbacks.onAddSource(), true);
  addBtn.style.width = "100%";
  addBtn.style.marginTop = "6px";
  addSlider(
    sourceBody,
    "Particles",
    { min: 1000, max: 100000, step: 1000 },
    () => currentCount,
    (v) => {
      currentCount = v;
      callbacks.onDensityChange(v);
    },
    (v) => `${(v / 1000).toFixed(0)}k`,
    false
  );

  // --- MEMORY ------------------------------------------------------------------
  const memBody = section("MEMORY");
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
    "MANUAL"
  );
  addObjSlider(memBody, "Memory", params.memory, "strength", 0, 20, 0.1, (v) => v.toFixed(1));
  addObjSlider(memBody, "Decay", params.memory, "decay", 0, 3, 0.01, num);
  addObjSlider(memBody, "Reconstruction", params.memory, "reconstructionEase", 0.5, 4, 0.05, num);

  // --- LIFE ------------------------------------------------------------------------
  const lifeBody = section("LIFE");
  addObjSlider(lifeBody, "Attraction", params.life, "attraction", 0, 2, 0.01, num);
  addObjSlider(lifeBody, "Repulsion", params.life, "repulsion", 0, 2, 0.01, num);
  addObjSlider(lifeBody, "Radius", params.life, "interactionRadius", 0.2, 2, 0.01, num);
  addObjSlider(lifeBody, "Force", params.life, "forceScale", 0, 14, 0.1, (v) => v.toFixed(1));
  addObjSlider(lifeBody, "Chaos", params.life, "chaos", 0, 1, 0.01, num);
  addObjSlider(lifeBody, "Friction", params.life, "friction", 0.5, 0.98, 0.005, (v) => v.toFixed(3));
  addObjSlider(lifeBody, "Core", params.life, "coreRadius", 0.1, 0.5, 0.01, num);
  {
    const row = document.createElement("div");
    row.className = "row";
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
    syncFns.push(() => {
      input.value = String(speciesCount);
      val.textContent = String(speciesCount);
    });
  }
  {
    const row = document.createElement("div");
    row.className = "row";
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
    syncFns.push(() => {
      select.value = params.life.kernel;
    });
  }

  // --- FIELD --------------------------------------------------------------------------
  const fieldBody = section("FIELD");
  addObjSlider(fieldBody, "Turbulence", params, "turbulence", 0, 1, 0.01, num);
  addObjSlider(fieldBody, "Drift", params, "drift", -1, 1, 0.01, num);
  addObjSlider(fieldBody, "Gravity", params, "gravity", -2, 2, 0.01, num);

  // --- VISUAL --------------------------------------------------------------------------
  const visBody = section("VISUAL");
  addObjSlider(visBody, "Size", visual, "particleSize", 0.4, 4, 0.05, num);
  addObjSlider(visBody, "Glow", visual, "glow", 0, 2, 0.05, num);
  addObjSlider(visBody, "Opacity", visual, "opacity", 0.05, 1, 0.01, num);
  addObjSlider(visBody, "Depth", visual, "dof", 0, 1, 0.01, num);
  addObjSlider(visBody, "Fog", visual, "fogDensity", 0, 0.12, 0.002, (v) => v.toFixed(3));
  addObjSlider(visBody, "Trail", visual, "trailDecay", 0.2, 0.95, 0.01, num);
  addToggle(visBody, "Trails", () => visual.trails, (v) => (visual.trails = v), "ON", "OFF");
  addToggle(visBody, "Color", () => visual.colorMode === "source", (v) => (visual.colorMode = v ? "source" : "monochrome"), "SOURCE", "MONO");

  // --- PRESETS --------------------------------------------------------------------------
  const presetBody = section("PRESETS");
  const presetGrid = document.createElement("div");
  presetGrid.className = "btn-grid";
  const presetBtns = new Map<string, HTMLButtonElement>();
  for (const def of PRESET_DEFINITIONS) {
    const btn = document.createElement("button");
    btn.className = "act";
    btn.textContent = def.label.toUpperCase();
    btn.title = def.description;
    btn.addEventListener("click", () => callbacks.onPreset(def.name));
    presetGrid.appendChild(btn);
    presetBtns.set(def.name, btn);
  }
  presetBody.appendChild(presetGrid);
  syncFns.push(() => {
    for (const btn of presetBtns.values()) btn.classList.remove("on");
  });

  // --- ACTIONS ---------------------------------------------------------------------------
  const actBody = section("ACTIONS");
  const actGrid = document.createElement("div");
  actGrid.className = "btn-grid";
  const mkAct = (label: string, fn: () => void, primary = false) => {
    const b = document.createElement("button");
    b.className = primary ? "act primary" : "act";
    b.textContent = label;
    b.addEventListener("click", fn);
    actGrid.appendChild(b);
  };
  mkAct("RECONSTRUCT", () => callbacks.onReconstruct(), true);
  mkAct("RELEASE", () => callbacks.onRelease(), true);
  mkAct("RANDOMIZE", () => callbacks.onRandomize());
  mkAct("UNDO", () => callbacks.onUndo());
  mkAct("RESET", () => callbacks.onReset());
  mkAct("FULLSCREEN", () => callbacks.onFullscreen());
  actBody.appendChild(actGrid);

  // Footer: stats, transient status, credit.
  const footer = document.createElement("div");
  footer.id = "panel-footer";
  const stats = document.createElement("div");
  stats.id = "panel-stats";
  stats.textContent = "—";
  const status = document.createElement("div");
  status.id = "panel-status";
  const credit = document.createElement("div");
  credit.className = "credit";
  credit.innerHTML =
    '<a href="https://mehran-ahmadi.com/" target="_blank" rel="noopener">DEVELOPED BY MEHRAN AHMADI © 2026</a>';
  footer.append(stats, status, credit);
  panel.appendChild(footer);

  // Visibility toggle.
  const head = document.createElement("div");
  head.className = "panel-head";
  head.innerHTML =
    '<span class="brand"><img src="/icons/void-64.png" alt="" />VOID</span><span id="panel-state">RECONSTRUCT</span>';
  const hideBtn = document.createElement("button");
  hideBtn.className = "panel-toggle";
  hideBtn.textContent = "HIDE";
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

  return {
    element: panel,
    setSourceInfo(name, kind, detail, count) {
      sourceMeta.innerHTML = `<b>${name}</b>\n${kind.toUpperCase()} · ${detail}\n${count.toLocaleString()} particles`;
    },
    setCount(count) {
      currentCount = count;
    },
    setActivePreset(name) {
      for (const [pname, btn] of presetBtns) btn.classList.toggle("on", pname === name);
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
    toggleVisible() {
      setPanelVisible(panel.style.display !== "none");
    },
    refresh() {
      for (const fn of syncFns) fn();
    },
  };
}
