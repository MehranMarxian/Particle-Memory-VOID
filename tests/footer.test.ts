// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createCredit, creditParts, installFooter } from "@/ui/footer";

describe("the page footer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the artist and the version, in one line", () => {
    const footer = installFooter();
    expect(footer.id).toBe("void-footer");
    expect(footer.textContent).toBe(`© 2026 Mehran Ahmadi · v${__APP_VERSION__}`);
    expect(footer.getAttribute("role")).toBe("contentinfo");
  });

  it("links the name to the artist, safely", () => {
    const a = installFooter().querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://mehran-ahmadi.com/");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.textContent).toBe("© 2026 Mehran Ahmadi");
  });

  it("is installed once, however often it is asked for", () => {
    installFooter();
    installFooter();
    expect(document.querySelectorAll("#void-footer")).toHaveLength(1);
  });

  it("shows the version the package carries", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(__APP_VERSION__).toBe(pkg.version);
    expect(creditParts().version).toBe(`v${pkg.version}`);
    expect(creditParts("9.9.9").version).toBe("v9.9.9");
  });

  it("the phone's credit is the same line", () => {
    expect(createCredit("credit nav-credit").textContent).toBe(`© 2026 Mehran Ahmadi · v${__APP_VERSION__}`);
  });
});

describe("the footer's room in the layout", () => {
  const css = readFileSync("src/ui/panel.css", "utf8");

  it("reserves its height before the phone rules, so the phone can take it back", () => {
    const base = css.indexOf("--foot: 18px");
    const phone = css.indexOf("@media (max-width: 760px)");
    expect(base).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(base);
    // The phone zeroes it and hides the footer, after the desktop definitions.
    const phoneRules = css.slice(phone, css.indexOf("prefers-reduced-motion"));
    expect(phoneRules).toContain("--foot: 0px");
    expect(phoneRules).toMatch(/#void-footer\s*\{\s*display:\s*none/);
    expect(css.indexOf("#void-footer {")).toBeLessThan(phone);
  });

  it("lifts everything that sits above the bottom by the footer's height", () => {
    // The dock and the things anchored to it must not slide under the footer.
    expect(css).toMatch(/#void-looks\s*\{[^}]*bottom:\s*calc\(10px \+ var\(--foot\)\)/);
    expect(css).toContain("calc(140px + var(--foot))");
    expect(css).toContain("var(--dock) - var(--foot)");
  });

  it("leaves when the piece is alone in a room", () => {
    expect(css).toMatch(/body\.screensaver #void-footer\s*\{\s*display:\s*none/);
  });
});
