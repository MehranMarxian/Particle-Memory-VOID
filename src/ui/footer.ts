/**
 * THE FOOTER (v0.11.2): who made the piece, and which version this is, in
 * one quiet line at the bottom of the page.
 *
 * It is a page footer, not a panel's: it stays when every panel is closed,
 * and leaves only when the piece is alone in a room (the screensaver, the
 * exhibition) or embedded as a demo card. On a phone the same line lives
 * under the bottom bar (see the nav credit in ui/panel.ts).
 */
export const CREDIT_NAME = "Mehran Ahmadi";
export const CREDIT_URL = "https://mehran-ahmadi.com/";

/** The credit line's parts, shared by the footer and the phone bar. */
export function creditParts(version: string = __APP_VERSION__): { text: string; href: string; version: string } {
  return { text: `© 2026 ${CREDIT_NAME}`, href: CREDIT_URL, version: `v${version}` };
}

/** Build the credit line: the name links to the artist, the version follows. */
export function createCredit(className = "credit"): HTMLElement {
  const parts = creditParts();
  const el = document.createElement("div");
  el.className = className;
  const a = document.createElement("a");
  a.href = parts.href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = parts.text;
  el.append(a, ` · ${parts.version}`);
  return el;
}

/** Put the footer on the page (once). Returns it. */
export function installFooter(parent: HTMLElement = document.body): HTMLElement {
  const existing = document.getElementById("void-footer");
  if (existing) return existing;
  const footer = document.createElement("footer");
  footer.id = "void-footer";
  footer.setAttribute("role", "contentinfo");
  footer.appendChild(createCredit("void-credit"));
  parent.appendChild(footer);
  return footer;
}
