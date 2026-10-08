import {
  BAND_SOURCES,
  isBandSource,
  isOscSource,
  parseMidiSource,
  sourceLabel,
  type BandShape,
  type Mapping,
  type ModTarget,
  type Modulator,
} from "./modulation";

/**
 * The mapping editor (0.12 slice 5), a lazy chunk: opened from a slider's
 * listen dot, it sits under the slider's row. Pick a source (a sound band,
 * a MIDI control by learning it, an OSC address), the span it plays the
 * slider over, and - for a band - how that band is shaped.
 */
export interface EditorDeps {
  modulator: Modulator;
  targets: ReadonlyMap<string, ModTarget>;
  soundOn(): boolean;
  /** Start MIDI and, if `learn` is given, call it with the next control moved. */
  midi(learn: ((channel: number, cc: number) => void) | null): void;
  /** The OSC bridge's address, and a way to connect to a new one. */
  oscUrl(): string;
  connectOsc(url: string): void;
  /** Something changed: save, repaint the dot. */
  onChange(): void;
}

const CSS = `
#void-studio .mod-editor {
  margin: 2px 0 8px;
  padding: 8px 8px 6px;
  border: 1px solid color-mix(in srgb, var(--ink-dim) 35%, transparent);
  border-radius: 6px;
  display: grid;
  gap: 6px;
  font-size: 10px;
}
#void-studio .mod-editor .mod-head { display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.12em; color: var(--ink-dim); }
#void-studio .mod-editor .mod-head button { background: none; border: 0; color: var(--ink-dim); cursor: pointer; font: inherit; padding: 2px 4px; }
#void-studio .mod-editor .mod-chips { display: flex; flex-wrap: wrap; gap: 4px; }
#void-studio .mod-editor .mod-chips button {
  font: inherit; letter-spacing: 0.08em; padding: 3px 6px; border-radius: 4px; cursor: pointer;
  background: none; color: var(--ink-dim); border: 1px solid color-mix(in srgb, var(--ink-dim) 40%, transparent);
}
#void-studio .mod-editor .mod-chips button.on { color: var(--ink); border-color: var(--accent); }
#void-studio .mod-editor .mod-meter { height: 3px; background: color-mix(in srgb, var(--ink-dim) 20%, transparent); border-radius: 2px; overflow: hidden; }
#void-studio .mod-editor .mod-meter > i { display: block; height: 100%; width: 0; background: var(--accent); }
#void-studio .mod-editor .mod-note { color: var(--ink-dim); }
#void-studio .mod-editor input[type="text"] {
  font: inherit; width: 100%; box-sizing: border-box; padding: 3px 5px; border-radius: 4px;
  background: transparent; color: var(--ink); border: 1px solid color-mix(in srgb, var(--ink-dim) 40%, transparent);
}
#void-studio .mod-editor .mod-line { display: grid; grid-template-columns: 1fr auto; gap: 4px; align-items: center; }
`;

let styled = false;
let open: { el: HTMLElement; timer: number } | null = null;

export function closeEditor(): void {
  if (!open) return;
  window.clearInterval(open.timer);
  open.el.remove();
  open = null;
}

/** Open the editor for `targetId` under `row` (closing any other). Pressing the same dot again closes it. */
export function openEditor(targetId: string, row: HTMLElement, deps: EditorDeps): void {
  const again = open?.el.dataset.target === targetId;
  closeEditor();
  if (again) return;
  const target = deps.targets.get(targetId);
  if (!target) return;
  if (!styled) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    styled = true;
  }
  const m = deps.modulator;
  const el = document.createElement("div");
  el.className = "mod-editor";
  el.dataset.target = targetId;
  el.addEventListener("click", (e) => e.stopPropagation());
  row.after(el);

  const render = () => {
    el.replaceChildren();
    const mapping = m.mappingFor(targetId);
    const head = document.createElement("div");
    head.className = "mod-head";
    const title = document.createElement("span");
    title.textContent = `LISTEN · ${target.label.toUpperCase()}${mapping ? ` ← ${sourceLabel(mapping.source)}` : ""}`;
    const x = document.createElement("button");
    x.textContent = "×";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closeEditor);
    head.append(title, x);
    el.appendChild(head);

    // Sources.
    const chips = document.createElement("div");
    chips.className = "mod-chips";
    const chip = (label: string, on: boolean, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", fn);
      chips.appendChild(b);
    };
    const kind = !mapping ? "off" : isBandSource(mapping.source) ? mapping.source : parseMidiSource(mapping.source) ? "midi" : "osc";
    chip("OFF", kind === "off", () => {
      m.unmap(targetId, deps.targets);
      deps.midi(null);
      changed();
    });
    for (const b of BAND_SOURCES) {
      chip(b.toUpperCase(), kind === b, () => {
        m.map(target, b);
        changed();
      });
    }
    chip("MIDI", kind === "midi", () => learnMidi());
    chip("OSC", kind === "osc", () => {
      m.map(target, `osc:/void/${targetId.split(".").pop()}`);
      changed();
    });
    el.appendChild(chips);

    const note = (text: string) => {
      const n = document.createElement("div");
      n.className = "mod-note";
      n.textContent = text;
      el.appendChild(n);
      return n;
    };

    if (!mapping) {
      note(learning ? "MOVE A MIDI CONTROL..." : "Let sound, a MIDI control or an OSC message play this slider.");
      return;
    }

    if (isBandSource(mapping.source)) {
      if (!deps.soundOn()) note("SOUND IS OFF: turn it on (L) to hear it.");
      const band = mapping.source;
      const shape = m.state.bands[band];
      note(`${band.toUpperCase()}, shaped for every slider that hears it:`);
      bandSlider("Gain", shape, "gain", 0, 8, 0.05);
      bandSlider("Curve", shape, "exp", 0.2, 4, 0.05);
      bandSlider("Attack", shape, "attack", 0.005, 1, 0.005);
      bandSlider("Decay", shape, "decay", 0.02, 3, 0.01);
    } else if (parseMidiSource(mapping.source)) {
      const line = document.createElement("div");
      line.className = "mod-line";
      const t = document.createElement("span");
      t.className = "mod-note";
      t.textContent = learning ? "MOVE A MIDI CONTROL..." : sourceLabel(mapping.source);
      const relearn = document.createElement("button");
      relearn.type = "button";
      relearn.textContent = "LEARN";
      relearn.addEventListener("click", learnMidi);
      line.append(t, relearn);
      el.appendChild(line);
    } else if (isOscSource(mapping.source)) {
      textField("Address", mapping.source.slice(4), (v) => {
        const src = `osc:${v.startsWith("/") ? v : `/${v}`}`;
        if (isOscSource(src)) {
          m.map(target, src);
          changed(false);
        }
      });
      textField("Bridge", deps.oscUrl(), (v) => deps.connectOsc(v), "CONNECT");
      note("OSC arrives through a WebSocket bridge; values 0-1.");
    }

    rangeSlider("From", mapping, "min", target.min, target.max);
    rangeSlider("To", mapping, "max", target.min, target.max);
    rangeSlider("Gain", mapping, "gain", 0, 4);

    const meter = document.createElement("div");
    meter.className = "mod-meter";
    const fill = document.createElement("i");
    meter.appendChild(fill);
    el.appendChild(meter);
    meterFill = fill;
  };

  let learning = false;
  let meterFill: HTMLElement | null = null;
  const changed = (rerender = true) => {
    deps.onChange();
    if (rerender) render();
  };
  function learnMidi(): void {
    learning = true;
    render();
    deps.midi((channel, cc) => {
      learning = false;
      m.map(target!, `midi:${channel}:${cc}`);
      deps.midi(null);
      changed();
    });
  }

  function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): void {
    const r = document.createElement("div");
    r.className = "row";
    const l = document.createElement("label");
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.setAttribute("aria-label", label);
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = get().toFixed(2);
    input.addEventListener("input", () => {
      set(Number(input.value));
      val.textContent = Number(input.value).toFixed(2);
      deps.onChange();
    });
    r.append(l, input, val);
    el.appendChild(r);
  }
  function bandSlider(label: string, shape: BandShape, key: keyof BandShape, min: number, max: number, step: number): void {
    slider(label, min, max, step, () => shape[key], (v) => (shape[key] = v));
  }
  function rangeSlider(label: string, mapping: Mapping, key: "min" | "max" | "gain", min: number, max: number): void {
    slider(label, Math.min(min, max), Math.max(min, max), Math.abs(max - min) / 200, () => mapping[key], (v) => (mapping[key] = v));
  }
  function textField(label: string, value: string, commit: (v: string) => void, button = "SET"): void {
    const line = document.createElement("div");
    line.className = "mod-line";
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.setAttribute("aria-label", label);
    input.spellcheck = false;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = button;
    const go = () => commit(input.value.trim());
    b.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing is not a shortcut
      if (e.key === "Enter") go();
    });
    line.append(input, b);
    el.appendChild(line);
  }

  render();
  const timer = window.setInterval(() => {
    const mapping = m.mappingFor(targetId);
    if (meterFill && mapping) meterFill.style.width = `${Math.round(Math.min(1, m.value(mapping.source) * mapping.gain) * 100)}%`;
  }, 80);
  open = { el, timer };
}
