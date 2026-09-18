/**
 * Screensaver / fullscreen experience (spec §19, §20).
 *
 * enter(): fullscreen (best-effort), UI hidden via body.screensaver, the
 * authored memory cycle forced on, cursor gone. Any real user input after
 * a short grace window exits back to the editor.
 *
 * The exit decision is a pure function so it can be unit-tested: input is
 * ignored during the settle window (moving the mouse to launch must not
 * kill the screensaver), and tiny tremors under `moveThresholdPx` don't
 * count either.
 */

export const GRACE_MS = 2500;
export const MOVE_THRESHOLD_PX = 14;

export interface InputEventLike {
  /** "pointermove" covers mouse, touch and pen drags alike. */
  type: "mousemove" | "pointermove" | "pointerdown" | "keydown" | "wheel";
  /** movement delta since the last event of the same type */
  dx?: number;
  dy?: number;
}

/** Pure decision: should this input event end the screensaver? */
export function exitRequested(
  ev: InputEventLike,
  nowMs: number,
  enteredAtMs: number,
  graceMs = GRACE_MS,
  moveThresholdPx = MOVE_THRESHOLD_PX
): boolean {
  if (nowMs - enteredAtMs < graceMs) return false;
  if (ev.type === "mousemove" || ev.type === "pointermove") {
    const dx = ev.dx ?? 0;
    const dy = ev.dy ?? 0;
    return Math.hypot(dx, dy) >= moveThresholdPx;
  }
  return true; // any key, click, or deliberate wheel ends it
}

export class ScreensaverMode {
  active = false;
  onEnter: () => void = () => undefined;
  onExit: () => void = () => undefined;

  private enteredAt = 0;
  private lastMouse = { x: 0, y: 0 };
  private handlers: Array<[EventTarget, string, EventListener]> = [];

  constructor(
    private doc: Document = document,
    private fullscreenElement: HTMLElement = document.documentElement
  ) {}

  async enter(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.enteredAt = performance.now();
    this.lastMouse = { x: -1e9, y: -1e9 };
    this.doc.body.classList.add("screensaver");

    const d = this.doc;
    const on = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      this.handlers.push([target, type, fn]);
    };
    // Pointer events cover the mouse AND touch: a finger drag ends the
    // screensaver exactly the way a mouse drag does.
    on(d, "pointermove", (e) => this.onInput("pointermove", (e as PointerEvent).clientX, (e as PointerEvent).clientY));
    on(d, "pointerdown", () => this.onInput("pointerdown"));
    on(d, "keydown", () => this.onInput("keydown"));
    on(d, "wheel", () => this.onInput("wheel"));

    try {
      if (!d.fullscreenElement) await this.fullscreenElement.requestFullscreen();
    } catch {
      // Fullscreen can be denied (iframe, user gesture rules) — the
      // screensaver still runs, just in-window.
    }
    this.onEnter();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    for (const [target, type, fn] of this.handlers.splice(0)) {
      target.removeEventListener(type, fn);
    }
    this.doc.body.classList.remove("screensaver");
    try {
      if (this.doc.fullscreenElement) void this.doc.exitFullscreen();
    } catch {
      /* ignore */
    }
    this.onExit();
  }

  private onInput(type: InputEventLike["type"], x?: number, y?: number): void {
    if (!this.active) return;
    let dx: number | undefined;
    let dy: number | undefined;
    if (type === "mousemove" && x !== undefined && y !== undefined) {
      dx = x - this.lastMouse.x;
      dy = y - this.lastMouse.y;
      const firstMove = this.lastMouse.x < -1e8;
      this.lastMouse = { x, y };
      if (firstMove) return; // first sample only seeds the delta
    }
    if (exitRequested({ type, dx, dy }, performance.now(), this.enteredAt)) {
      this.exit();
    }
  }
}

/** Editor-quality-of-life: hide the cursor after `idleMs` without mouse movement. */
export function attachIdleCursorHiding(doc: Document, idleMs = 4000): () => void {
  let timer = 0;
  const wake = () => {
    doc.body.classList.remove("cursor-hidden");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => doc.body.classList.add("cursor-hidden"), idleMs);
  };
  doc.addEventListener("mousemove", wake);
  doc.addEventListener("pointerdown", wake);
  doc.addEventListener("keydown", wake);
  wake();
  return () => {
    doc.removeEventListener("mousemove", wake);
    doc.removeEventListener("pointerdown", wake);
    doc.removeEventListener("keydown", wake);
    window.clearTimeout(timer);
  };
}
