// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createPanel, type PanelCallbacks } from "@/ui/panel";
import { defaultEngineParams } from "@/types";
import { defaultVisualSettings } from "@/rendering/VisualSettings";
import { MemorySystem } from "@/memory/MemorySystem";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEcologyParams } from "@/ecology/ecologySystem";

/**
 * The three-tier panel. These tests pin the information architecture: what
 * lives in the always-visible piece, what folds into the instrument, what
 * hides in the lab, and that the accordion behaves.
 */

const TIER2_SECTIONS = [
  "MEMORY",
  "LIFE",
  "FIELD",
  "SCENT & HEAT",
  "ECOLOGY",
  "VISUAL",
  "SOUND",
  "EVOLVE",
  "PRESETS",
  "ACTIONS",
];

function makeCallbacks(): PanelCallbacks & { calls: string[] } {
  const calls: string[] = [];
  const noop = (name: string) => () => calls.push(name);
  return {
    calls,
    onDensityChange: noop("density"),
    onAddSource: noop("addSource"),
    onPreset: noop("preset"),
    onRandomize: noop("randomize"),
    onUndo: noop("undo"),
    onReset: noop("reset"),
    onReconstruct: noop("reconstruct"),
    onRelease: noop("release"),
    onFullscreen: noop("fullscreen"),
    onScreensaver: noop("screensaver"),
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
  };
}

function makePanel() {
  const callbacks = makeCallbacks();
  const api = createPanel({
    params: defaultEngineParams(),
    visual: defaultVisualSettings(),
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
    callbacks,
  });
  document.body.appendChild(api.element);
  return { api, callbacks, panel: api.element };
}

describe("the panel's three tiers", () => {
  let p: ReturnType<typeof makePanel>;
  beforeEach(() => {
    p = makePanel();
  });

  it("tier 1 always shows the piece: the great gestures and the doors", () => {
    const tier1 = p.panel.querySelector(".panel-tier1")!;
    expect(tier1).toBeTruthy();
    for (const label of ["RECONSTRUCT", "RELEASE", "SCREENSAVER", "FULLSCREEN", "INSTRUMENT", "LAB"]) {
      const btn = [...tier1.querySelectorAll("button")].find((b) => b.textContent === label);
      expect(btn, `${label} in tier 1`).toBeTruthy();
    }
    // The density slider lives here too.
    const slider = tier1.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
  });

  it("the source chip is the door to the picker", () => {
    const chip = p.panel.querySelector("#panel-source-chip") as HTMLButtonElement;
    chip.click();
    expect(p.callbacks.calls).toContain("addSource");
  });

  it("tier 2 starts hidden and holds every instrument section, closed", () => {
    const tier2 = p.panel.querySelector(".panel-tier2") as HTMLElement;
    expect(tier2.style.display).toBe("none");
    const titles = [...tier2.querySelectorAll("section > h3")].map((h) => h.textContent);
    expect(titles).toEqual(TIER2_SECTIONS);
    for (const sec of tier2.querySelectorAll("section")) {
      expect(sec.classList.contains("closed"), `${sec.querySelector("h3")?.textContent} closed`).toBe(true);
    }
  });

  it("the instrument door opens tier 2 and closes the lab", () => {
    const doors = [...p.panel.querySelectorAll<HTMLElement>(".panel-doors button")];
    const instrument = doors.find((b) => b.textContent === "INSTRUMENT")!;
    const lab = doors.find((b) => b.textContent === "LAB")!;
    instrument.click();
    expect((p.panel.querySelector(".panel-tier2") as HTMLElement).style.display).toBe("block");
    lab.click();
    expect((p.panel.querySelector(".panel-tier2") as HTMLElement).style.display).toBe("none");
    expect((p.panel.querySelector(".panel-tier3") as HTMLElement).style.display).toBe("block");
    lab.click();
    expect((p.panel.querySelector(".panel-tier3") as HTMLElement).style.display).toBe("none");
  });

  it("the accordion opens one section at a time", () => {
    p.panel.querySelectorAll<HTMLElement>(".panel-doors button")[0]!.click();
    const tier2 = p.panel.querySelector(".panel-tier2")!;
    const [memory, life] = [...tier2.querySelectorAll("section")] as HTMLElement[];
    (memory.querySelector("h3") as HTMLElement).click();
    expect(memory.classList.contains("closed")).toBe(false);
    (life.querySelector("h3") as HTMLElement).click();
    expect(life.classList.contains("closed")).toBe(false);
    expect(memory.classList.contains("closed")).toBe(true);
    (life.querySelector("h3") as HTMLElement).click();
    expect(life.classList.contains("closed")).toBe(true);
  });

  it("tier 3 hides the lab: the backend switch, the ghost, and the stats", () => {
    const tier3 = p.panel.querySelector(".panel-tier3") as HTMLElement;
    expect(tier3.style.display).toBe("none");
    p.panel.querySelectorAll<HTMLElement>(".panel-doors button")[1]!.click();
    expect(tier3.style.display).toBe("block");
    const sim = tier3.querySelector("button.sim") as HTMLButtonElement;
    expect(sim.textContent).toBe("SIM: GPU");
    sim.click();
    expect(p.callbacks.calls).toContain("backend");
    expect(tier3.querySelector("#panel-stats")).toBeTruthy();
    // the ghost toggle moved here from the field
    const ghostRow = [...tier3.querySelectorAll(".row label")].find((l) => l.textContent === "Ghost");
    expect(ghostRow).toBeTruthy();
  });
});
