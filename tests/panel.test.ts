// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createPanel, LAYOUT_KEY, type PanelCallbacks } from "@/ui/panel";
import { defaultEngineParams } from "@/types";
import { defaultVisualSettings } from "@/rendering/VisualSettings";
import { MemorySystem } from "@/memory/MemorySystem";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEcologyParams } from "@/ecology/ecologySystem";
import { defaultMacros } from "@/presets/macros";
import { PRESET_DEFINITIONS } from "@/presets/presets";

/**
 * The studio (v0.11.0). These tests pin the layout: the gestures on top,
 * the tools on the left, the properties on the right, the looks at the
 * bottom - every action an icon with a name - and that each panel can be
 * closed, reopened and remembered.
 */

const SECTIONS = ["MOTION", "MEMORY", "LIFE", "FIELD", "SCENT & HEAT", "MEDIUM", "ECOLOGY", "VISUAL", "SOUND", "EVOLVE", "LAB"];

function makeCallbacks(): PanelCallbacks & { calls: string[] } {
  const calls: string[] = [];
  const noop = (name: string) => () => calls.push(name);
  return {
    calls,
    onDensityChange: noop("density"),
    onAddSource: noop("addSource"),
    onPreset: (name: string) => calls.push(`preset:${name}`),
    onMacro: noop("macro"),
    onRandomize: noop("randomize"),
    onUndo: noop("undo"),
    onReset: noop("reset"),
    onReconstruct: noop("reconstruct"),
    onRelease: noop("release"),
    onGenesis: noop("genesis"),
    onFullscreen: noop("fullscreen"),
    onScreensaver: noop("screensaver"),
    onTogglePause: noop("pause"),
    onCapture: noop("capture"),
    onBackendToggle: noop("backend"),
    onSpeciesChange: noop("species"),
    onUserInteraction: noop("interaction"),
    onToggleCycle: noop("cycle"),
    onToggleGuide: noop("guide"),
    onEcologyToggle: noop("ecology"),
    onSoundToggle: noop("sound"),
    onEvolveToggle: noop("evolve"),
    onSoundSourceChange: noop("soundSource"),
    onSoundscapeToggle: noop("soundscape"),
    onPresenceToggle: noop("presence"),
    onWindToggle: noop("wind"),
    onCutoutToggle: noop("cutout"),
    onExhibition: noop("exhibition"),
  };
}

function makePanel(
  overrides: { cutout?: () => { available: boolean; active: boolean; busy: boolean }; wind?: { enabled: boolean; strength: number } } = {}
) {
  document.body.innerHTML = ""; // isolate: createPanel appends to the body
  const callbacks = makeCallbacks();
  const visual = defaultVisualSettings();
  const api = createPanel({
    params: defaultEngineParams(),
    visual,
    macros: defaultMacros(),
    memory: new MemorySystem({ auto: false }),
    matrix: new InteractionMatrix(4),
    speciesCount: 4,
    currentCount: 12000,
    sound: { enabled: false, sensitivity: 1, source: "mic" },
    soundscape: { enabled: false, volume: 0.5 },
    evolve: { enabled: false, trialSeconds: 6, mutation: 0.25, phenotype: false, ecology: false },
    pointer: { strength: 0.5, mode: 1, ghost: true },
    backend: () => "gpu",
    ecology: defaultEcologyParams(),
    ecologyEvents: { births: 0, deaths: 0 },
    presence: { enabled: false },
    wind: overrides.wind ?? { enabled: false, strength: 1 },
    cutout: overrides.cutout ?? (() => ({ available: false, active: false, busy: false })),
    callbacks,
  });
  document.body.appendChild(api.element);
  return { api, callbacks, studio: api.element, visual };
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;

describe("the studio layout", () => {
  let p: ReturnType<typeof makePanel>;
  beforeEach(() => {
    window.localStorage.clear();
    p = makePanel();
  });

  it("puts the great gestures on top, each an icon with its name", () => {
    const expected: Record<string, string> = {
      source: "addSource",
      genesis: "genesis",
      reconstruct: "reconstruct",
      release: "release",
      pause: "pause",
      capture: "capture",
      screensaver: "screensaver",
      fullscreen: "fullscreen",
      exhibit: "exhibition",
    };
    for (const [action, call] of Object.entries(expected)) {
      const btn = q<HTMLButtonElement>(`#void-topbar [data-action="${action}"]`);
      expect(btn, action).toBeTruthy();
      expect(btn.querySelector("svg"), `${action} icon`).toBeTruthy();
      expect(btn.querySelector(".lbl")?.textContent, `${action} label`).toBeTruthy();
      btn.click();
      expect(p.callbacks.calls).toContain(call);
    }
  });

  it("the source chip is the door to the picker", () => {
    q<HTMLButtonElement>("#panel-source-chip").click();
    expect(p.callbacks.calls).toContain("addSource");
  });

  it("the tool rail opens one flyout at a time, and a second tap closes it", () => {
    const flyout = q("#void-flyout");
    expect(flyout.hidden).toBe(true);
    q<HTMLButtonElement>('[data-action="tool-color"]').click();
    expect(flyout.hidden).toBe(false);
    const visible = [...flyout.querySelectorAll<HTMLElement>(".flyout-body")].filter((b) => !b.hidden);
    expect(visible).toHaveLength(1);
    q<HTMLButtonElement>('[data-action="tool-shape"]').click();
    expect([...flyout.querySelectorAll<HTMLElement>(".flyout-body")].filter((b) => !b.hidden)).toHaveLength(1);
    q<HTMLButtonElement>('[data-action="tool-shape"]').click();
    expect(flyout.hidden).toBe(true);
  });

  it("a colour swatch changes the look and keeps the other panel in step", () => {
    q<HTMLButtonElement>('[data-action="tool-color"]').click();
    const species = q<HTMLButtonElement>('#void-flyout [aria-label="Color: species"]');
    species.click();
    expect(p.visual.colorMode).toBe("species");
    const mirror = q<HTMLButtonElement>('#panel [aria-label="Color: species"]');
    expect(mirror.classList.contains("on")).toBe(true);
  });

  it("properties hold every section; MOTION starts open and sections fold independently", () => {
    const titles = [...document.querySelectorAll("#panel section .section-title")].map((h) => h.textContent);
    expect(titles).toEqual(SECTIONS);
    const [motion, memory, life] = [...document.querySelectorAll<HTMLElement>("#panel section")];
    expect(motion.classList.contains("closed")).toBe(false);
    expect(memory.classList.contains("closed")).toBe(true);
    memory.querySelector<HTMLButtonElement>(".section-toggle")!.click();
    life.querySelector<HTMLButtonElement>(".section-toggle")!.click();
    expect(memory.classList.contains("closed")).toBe(false);
    expect(life.classList.contains("closed")).toBe(false);
  });

  it("the lab keeps the backend switch and the stats", () => {
    const sim = q<HTMLButtonElement>("#panel button.sim");
    expect(sim.textContent).toBe("SIM: GPU");
    sim.click();
    expect(p.callbacks.calls).toContain("backend");
    expect(q("#panel-stats")).toBeTruthy();
  });

  it("the looks dock shows every look as a face", () => {
    const cards = document.querySelectorAll<HTMLButtonElement>("#void-looks .preset-card");
    expect(cards).toHaveLength(PRESET_DEFINITIONS.length);
    q<HTMLButtonElement>('#void-looks [data-preset="witness"]').click();
    expect(p.callbacks.calls).toContain("preset:witness");
    p.api.setActivePreset("witness");
    expect(q('#void-looks [data-preset="witness"]').classList.contains("on")).toBe(true);
    for (const a of ["randomize", "undo", "reset"]) {
      q<HTMLButtonElement>(`#void-looks [data-action="${a}"]`).click();
      expect(p.callbacks.calls).toContain(a);
    }
  });

  it("each panel closes, reopens from the top bar, and the layout is remembered", () => {
    q<HTMLButtonElement>("#panel .panel-head .close").click();
    expect(q("#panel").hidden).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_KEY)!).props).toBe(false);
    // A fresh studio honours the saved layout.
    makePanel();
    expect(q("#panel").hidden).toBe(true);
    q<HTMLButtonElement>('[data-action="window-props"]').click();
    expect(q("#panel").hidden).toBe(false);
  });

  it("HIDE stows the whole studio and the STUDIO button brings it back", () => {
    q<HTMLButtonElement>('[data-action="hide"]').click();
    expect(p.studio.classList.contains("stowed")).toBe(true);
    const show = q<HTMLButtonElement>("#panel-toggle-btn");
    expect(show.style.display).not.toBe("none");
    show.click();
    expect(p.studio.classList.contains("stowed")).toBe(false);
    p.api.toggleVisible();
    expect(p.studio.classList.contains("stowed")).toBe(true);
  });

  it("Moon Dust is a look like the others: in the dock, not the top bar", () => {
    expect(document.querySelector('#void-topbar [data-action="moon"]')).toBeNull();
    q<HTMLButtonElement>('#void-looks [data-preset="moon"]').click();
    expect(p.callbacks.calls).toContain("preset:moon");
  });

  it("the phone bar opens one sheet at a time, and a second tap puts it away", () => {
    const tab = (id: string) => q<HTMLButtonElement>(`#void-mobile-nav [data-action="sheet-${id}"]`);
    tab("looks").click();
    expect(p.studio.classList.contains("sheet-looks")).toBe(true);
    tab("props").click();
    expect(p.studio.classList.contains("sheet-looks")).toBe(false);
    expect(p.studio.classList.contains("sheet-props")).toBe(true);
    tab("props").click();
    expect(p.studio.className).not.toMatch(/sheet-/);
    tab("more").click();
    q<HTMLButtonElement>('#void-more [data-action="m-release"]').click();
    expect(p.callbacks.calls).toContain("release");
  });

  it("pause flips to play", () => {
    p.api.setPaused(true);
    expect(q('[data-action="pause"] .lbl').textContent).toBe("PLAY");
    p.api.setPaused(false);
    expect(q('[data-action="pause"] .lbl').textContent).toBe("PAUSE");
  });

  it("a touch-primary device starts with the piece first: tools and properties closed", () => {
    window.localStorage.clear();
    const original = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (query: string) =>
      ({ matches: query.includes("pointer: coarse"), media: query }) as MediaQueryList;
    makePanel();
    window.matchMedia = original;
    expect(q("#void-tools").hidden).toBe(true);
    expect(q("#panel").hidden).toBe(true);
    expect(q("#void-looks").hidden).toBe(false);
  });
});

describe("the room and the picture (v0.11.2)", () => {
  beforeEach(() => window.localStorage.clear());

  it("YOU carries Presence and Wind, each with its switch and its promise", () => {
    const p = makePanel();
    q<HTMLButtonElement>('[data-action="tool-presence"]').click();
    const body = [...q("#void-flyout").querySelectorAll<HTMLElement>(".flyout-body")].find((b) => !b.hidden)!;
    const text = body.textContent ?? "";
    expect(text).toContain("Wind");
    expect(text).toContain("Wind strength");
    // The privacy statement is said where the camera is switched on.
    expect(text).toContain("NOTHING IS KEPT OR SENT");
    const rows = [...body.querySelectorAll<HTMLElement>(".row")];
    const windRow = rows.find((r) => r.querySelector("label")?.textContent === "Wind")!;
    expect(windRow).toBeTruthy();
    (windRow.querySelector("button") as HTMLButtonElement).click();
    expect(p.callbacks.calls).toContain("wind");
  });

  it("the YOU tool lights when either camera feature is on", () => {
    makePanel({ wind: { enabled: true, strength: 1 } });
    expect(q('[data-action="tool-presence"]').classList.contains("lit")).toBe(true);
    makePanel();
    expect(q('[data-action="tool-presence"]').classList.contains("lit")).toBe(false);
  });

  it("the Background row shows only for a picture that can be cut, and cuts once", () => {
    let state = { available: false, active: false, busy: false };
    const p = makePanel({ cutout: () => state });
    const row = () =>
      [...document.querySelectorAll<HTMLElement>("#panel .row")].find((r) => r.querySelector("label")?.textContent === "Background")!;
    expect(row()).toBeTruthy();
    expect(row().style.display).toBe("none");
    state = { available: true, active: false, busy: false };
    p.api.refresh();
    expect(row().style.display).toBe("");
    const chips = [...row().querySelectorAll<HTMLButtonElement>("button")];
    expect(chips.map((b) => b.textContent)).toEqual(["KEPT", "CUT OUT"]);
    expect(chips[0].classList.contains("on")).toBe(true);
    chips[1].click();
    expect(p.callbacks.calls.filter((c) => c === "cutout")).toHaveLength(1);
    // Already cut: the button for the state it is in does nothing.
    state = { available: true, active: true, busy: false };
    p.api.refresh();
    const after = [...row().querySelectorAll<HTMLButtonElement>("button")];
    expect(after[1].classList.contains("on")).toBe(true);
    after[1].click();
    expect(p.callbacks.calls.filter((c) => c === "cutout")).toHaveLength(1);
  });

  it("FORM and KIN are there, and say what they do", () => {
    makePanel();
    const labels = [...document.querySelectorAll<HTMLElement>("#panel .row label")].map((l) => l.textContent);
    expect(labels).toContain("Form");
    expect(labels).toContain("Kin");
  });
});
