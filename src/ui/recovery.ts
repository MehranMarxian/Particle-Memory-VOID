/**
 * The recovery surface (v0.10.0 slice 3): a rendering failure surfaces in
 * the piece — one visible overlay with a message, COPY DIAGNOSTICS, and
 * CONTINUE / RELOAD — never a stack trace in the tab title, and never a
 * silent black canvas.
 *
 * index.html carries a minimal inline bus for the window before this
 * module arrives (it queues into window.__voidRecovery and shows a bare
 * overlay if the module itself never loads); installRecovery() replaces
 * that bus at boot. Console.error is deliberately NOT hooked: three.js
 * logs shader warnings through it, and a warning must not page the
 * overlay — window error events, unhandled rejections, and the frame
 * loop's catch are the triggers. ?debug=1 keeps the old title mode for
 * field use.
 */

export interface RecoveryPayload {
  message: string;
  stack?: string;
  /** Where it came from: "frame loop", "boot", the event type, ... */
  context?: string;
}

export interface DiagnosticFacts {
  backend?: string;
  density?: number;
  fps?: number;
}

/** The full COPY DIAGNOSTICS text: what support (or future-you) needs. */
export function buildDiagnostics(
  payload: RecoveryPayload,
  facts: DiagnosticFacts = {}
): string {
  const lines = [
    "VOID / PARTICLE MEMORY - DIAGNOSTICS",
    `when: ${new Date().toISOString()}`,
    `error: ${payload.message}`,
    payload.stack ? `stack:\n${payload.stack}` : "stack: (none)",
    payload.context ? `where: ${payload.context}` : null,
    `ua: ${navigator.userAgent}`,
    `url: ${location.href}`,
    facts.backend ? `backend: ${facts.backend}` : null,
    facts.density !== undefined ? `density: ${facts.density}` : null,
    facts.fps !== undefined ? `fps: ${facts.fps}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

export interface RecoveryPanel {
  show(payload: RecoveryPayload): void;
  hide(): void;
  readonly element: HTMLElement;
  /** The text COPY DIAGNOSTICS would place on the clipboard. */
  diagnostics(): string;
}

/**
 * The overlay panel. Built once, shown on failure, hidden by CONTINUE.
 * DOM-only so happy-dom can hold it to its contract.
 */
export function createRecoveryPanel(facts: () => DiagnosticFacts = () => ({})): RecoveryPanel {
  const element = document.createElement("div");
  element.id = "recovery";
  element.style.cssText =
    "position:fixed;inset:0;z-index:300;display:none;align-items:center;justify-content:center;" +
    "background:rgba(0,0,0,0.86)";
  const box = document.createElement("div");
  box.style.cssText =
    "box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;" +
    "margin:16px;padding:24px 22px;background:#0a0a0a;border:1px solid #3a3a3a;" +
    "color:#bdbdbd;font:12px/1.8 ui-monospace,monospace";
  const head = document.createElement("div");
  head.textContent = "THE PIECE HIT A PROBLEM";
  head.style.cssText = "color:#e8e8e8;letter-spacing:0.22em;margin-bottom:14px";
  const message = document.createElement("div");
  message.id = "recovery-message";
  // Error text can be one long token (a minified call): it must wrap anywhere.
  message.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:16px";
  const buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
  const mkButton = (id: string, label: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.id = id;
    b.textContent = label;
    b.style.cssText =
      "background:none;border:1px solid #4a4a4a;color:#cfcfcf;font:inherit;" +
      "letter-spacing:0.14em;padding:8px 14px;cursor:pointer";
    buttons.appendChild(b);
    return b;
  };
  const copyBtn = mkButton("recovery-copy", "COPY DIAGNOSTICS");
  const continueBtn = mkButton("recovery-continue", "CONTINUE");
  const reloadBtn = mkButton("recovery-reload", "RELOAD");
  box.append(head, message, buttons);
  element.append(box);

  let last: RecoveryPayload = { message: "unknown" };
  copyBtn.addEventListener("click", () => {
    const text = panel.diagnostics();
    // Clipboard needs a secure context; the textarea fallback always works.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => selectFallback(text));
    } else {
      selectFallback(text);
    }
    copyBtn.textContent = "COPIED";
    window.setTimeout(() => (copyBtn.textContent = "COPY DIAGNOSTICS"), 1600);
  });
  const selectFallback = (text: string): void => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  };
  continueBtn.addEventListener("click", () => panel.hide());
  reloadBtn.addEventListener("click", () => window.location.reload());

  const panel: RecoveryPanel = {
    show(payload: RecoveryPayload): void {
      // A browser without WebGL already has its own, calmer explanation.
      if ((window as unknown as { __voidNoWebgl?: boolean }).__voidNoWebgl) return;
      last = payload;
      message.textContent =
        (payload.message || "UNKNOWN ERROR") +
        (payload.context ? `\n\nwhile: ${payload.context}` : "") +
        "\n\nCONTINUE leaves the piece running; RELOAD gives it a fresh start.";
      element.style.display = "flex";
    },
    hide(): void {
      element.style.display = "none";
    },
    element,
    diagnostics(): string {
      return buildDiagnostics(last, facts());
    },
  };
  return panel;
}

/** The bus the inline fallback and the frame loop report through. */
export interface RecoveryBus {
  report(payload: RecoveryPayload): void;
}

/** Report a failure from app code (the frame loop's catch, boot steps). */
export function reportRecovery(err: unknown, context: string): void {
  const payload =
    err instanceof Error
      ? { message: err.message, stack: err.stack, context }
      : { message: String(err).slice(0, 300), context };
  window.__voidRecovery?.report(payload);
}

declare global {
  interface Window {
    __voidRecovery?: RecoveryBus & { queue?: unknown[]; installed?: boolean };
  }
}

/**
 * Install the real recovery surface: replace the inline bus, drain its
 * queue, and hook window error events and unhandled rejections. Title
 * mode (?debug=1) writes document.title instead, for field use.
 */
export function installRecovery(
  facts: () => DiagnosticFacts = () => ({}),
  options: { debug?: boolean } = {}
): void {
  if (window.__voidRecovery?.installed) return;
  const debug = options.debug ?? new URLSearchParams(location.search).get("debug") === "1";
  // The inline bus (and anything queued on it) must be captured before
  // the real one replaces it.
  const previous = window.__voidRecovery;

  const toPayload = (err: unknown, context: string): RecoveryPayload => {
    if (err instanceof Error) return { message: err.message, stack: err.stack, context };
    const text = String(err);
    return { message: text.slice(0, 300), context };
  };

  if (debug) {
    const bus: RecoveryBus & { installed?: boolean; queue?: unknown[] } = {
      installed: true,
      report: (p) => {
        document.title = `ERR ${p.message} @ ${p.stack ?? ""}`.slice(0, 900);
      },
    };
    window.__voidRecovery = bus;
  } else {
    const panel = createRecoveryPanel(facts);
    document.body.appendChild(panel.element);
    const bus: RecoveryBus & { installed?: boolean; queue?: unknown[] } = {
      installed: true,
      report: (p) => panel.show(p),
    };
    window.__voidRecovery = bus;
  }

  // Drain whatever the inline bus queued before the module arrived.
  if (Array.isArray(previous?.queue)) {
    for (const item of previous.queue) {
      if (item && typeof item === "object") window.__voidRecovery.report(item as RecoveryPayload);
    }
    previous.queue.length = 0;
  }

  window.addEventListener("error", (e) => {
    window.__voidRecovery?.report(
      e.error instanceof Error
        ? toPayload(e.error, e.type)
        : { message: e.message || "unknown error", context: e.type }
    );
  });
  window.addEventListener("unhandledrejection", (e) => {
    window.__voidRecovery?.report(toPayload(e.reason, e.type));
  });
}
