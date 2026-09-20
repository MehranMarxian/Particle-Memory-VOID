// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildDiagnostics,
  createRecoveryPanel,
  installRecovery,
  reportRecovery,
} from "@/ui/recovery";

describe("recovery diagnostics", () => {
  it("carries the error, stack, context, and the instrument's facts", () => {
    const text = buildDiagnostics(
      { message: "cannot read radius of undefined", stack: "Error: ...\n  at frame", context: "frame loop" },
      { backend: "gpu", density: 12000, fps: 60 }
    );
    expect(text).toMatch(/DIAGNOSTICS/);
    expect(text).toMatch(/cannot read radius of undefined/);
    expect(text).toMatch(/at frame/);
    expect(text).toMatch(/where: frame loop/);
    expect(text).toMatch(/backend: gpu/);
    expect(text).toMatch(/density: 12000/);
    expect(text).toMatch(/fps: 60/);
    expect(text).toMatch(/ua: /);
    expect(text).toMatch(/url: /);
  });

  it("tolerates a missing stack and empty facts", () => {
    const text = buildDiagnostics({ message: "boom" });
    expect(text).toMatch(/stack: \(none\)/);
    expect(text).not.toMatch(/backend:/);
  });
});

describe("the recovery panel", () => {
  it("shows with the message, hides on demand, and diagnostics follow the last error", () => {
    let calls = 0;
    const panel = createRecoveryPanel(() => (calls++ === 0 ? { backend: "cpu" } : { backend: "gpu" }));
    expect(panel.element.style.display).toBe("none");
    panel.show({ message: "THE SWARM DIVERGED", context: "frame loop" });
    expect(panel.element.style.display).toBe("flex");
    expect(panel.element.textContent).toMatch(/THE SWARM DIVERGED/);
    expect(panel.element.textContent).toMatch(/while: frame loop/);
    expect(panel.diagnostics()).toMatch(/backend: cpu/);
    panel.hide();
    expect(panel.element.style.display).toBe("none");
    panel.show({ message: "SECOND" });
    expect(panel.diagnostics()).toMatch(/backend: gpu/);
    expect(panel.diagnostics()).toMatch(/SECOND/);
  });

  it("offers copy, continue, and reload", () => {
    const panel = createRecoveryPanel();
    panel.show({ message: "x" });
    const byId = (id: string) => panel.element.querySelector(`#${id}`);
    expect(byId("recovery-copy")?.textContent).toBe("COPY DIAGNOSTICS");
    expect(byId("recovery-continue")?.textContent).toBe("CONTINUE");
    expect(byId("recovery-reload")?.textContent).toBe("RELOAD");
  });
});

describe("installRecovery", () => {
  beforeEach(() => {
    delete (window as { __voidRecovery?: unknown }).__voidRecovery;
    document.body.innerHTML = "";
  });

  it("installs the bus, shows failures in the piece, and stays idempotent", () => {
    installRecovery();
    expect(window.__voidRecovery?.installed).toBe(true);
    window.__voidRecovery!.report({ message: "FRAME FAILED" });
    const overlay = document.querySelector("#recovery");
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toMatch(/FRAME FAILED/);
    // A window error event routes through the same surface.
    window.dispatchEvent(new ErrorEvent("error", { message: "event failure", error: new Error("event failure") }));
    expect(document.querySelectorAll("#recovery")).toHaveLength(1);
    expect(document.querySelector("#recovery")!.textContent).toMatch(/event failure/);
    // Second install must not stack a second overlay.
    installRecovery();
    expect(document.querySelectorAll("#recovery")).toHaveLength(1);
  });

  it("drains the inline bus's queue into the real panel", () => {
    (window as { __voidRecovery?: unknown }).__voidRecovery = {
      installed: false,
      queue: [{ message: "EARLY FAILURE" }],
      report: () => {},
    };
    installRecovery();
    expect(document.querySelector("#recovery")!.textContent).toMatch(/EARLY FAILURE/);
  });

  it("debug mode writes the title instead of the overlay", () => {
    installRecovery(undefined, { debug: true });
    window.__voidRecovery!.report({ message: "TITLE MODE", stack: "at x" });
    expect(document.title).toMatch(/TITLE MODE/);
    expect(document.querySelector("#recovery")).toBeNull();
  });

  it("reportRecovery shapes non-Error throwaways too", () => {
    installRecovery();
    reportRecovery(new Error("shaped"), "frame loop");
    expect(document.querySelector("#recovery")!.textContent).toMatch(/shaped/);
    reportRecovery("plain string", "boot");
    expect(document.querySelector("#recovery")!.textContent).toMatch(/plain string/);
  });
});
