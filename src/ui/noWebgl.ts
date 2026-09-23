/**
 * When the browser gives VOID no WebGL at all (Lockdown Mode, a privacy
 * browser that blocks it, hardware acceleration switched off), there is no
 * piece to recover: say so plainly, in the piece's own voice, and suggest
 * the way back. The recovery overlay stands down (see recovery.ts).
 */

/** Can this browser give us a WebGL context? Probed on a throwaway canvas. */
export function hasWebgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function showNoWebgl(): void {
  (window as unknown as { __voidNoWebgl?: boolean }).__voidNoWebgl = true;
  document.getElementById("splash")?.remove();
  const el = document.createElement("div");
  el.id = "no-webgl";
  el.style.cssText =
    "position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;" +
    "background:#000;color:#bdbdbd;font:12px/1.9 ui-monospace,monospace;padding:24px;box-sizing:border-box";
  el.innerHTML =
    '<div style="max-width:440px;overflow-wrap:anywhere">' +
    '<div style="color:#e8e8e8;letter-spacing:0.28em;margin-bottom:16px">VOID NEEDS WEBGL</div>' +
    "<p style=\"margin:0 0 14px\">This browser did not let the piece draw. That usually means WebGL is switched off: " +
    "a private or privacy browser that blocks it, iPhone Lockdown Mode, or hardware acceleration turned off.</p>" +
    '<p style="margin:0;color:#8a8a8a">Try opening this page in Safari or Chrome, or allow WebGL for this site.</p>' +
    "</div>";
  document.body.appendChild(el);
}

/** Thrown to stop the boot quietly once the explanation is on screen. */
export class NoWebglError extends Error {
  constructor() {
    super("WebGL is not available in this browser");
    this.name = "NoWebglError";
  }
}
