/**
 * The studio's icon set (v0.11.0): drawn for VOID, on a 24-unit grid, as
 * stroked paths in currentColor so every icon follows its button's state.
 * One picture per action, so the instrument reads without words - a child
 * should be able to find the moon, the camera and the dice.
 */

/** A circle as path data (so every icon stays a single <path>). */
const c = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

interface IconSpec {
  d: string;
  fill?: boolean;
  width?: number;
}

export const ICONS = {
  source: { d: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6" + c(16, 9, 1.6) },
  moon: { d: "M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9Z", fill: true },
  genesis: { d: "M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.2 3.2M15.8 15.8L19 19M19 5l-3.2 3.2M8.2 15.8L5 19" + c(12, 12, 1.4) },
  reconstruct: { d: "M4 4l5 5M9 5v4H5M20 4l-5 5M15 5v4h4M4 20l5-5M5 15h4v4M20 20l-5-5M19 15h-4v4" },
  release: { d: "M9 9L4 4M4 8V4h4M15 9l5-5M16 4h4v4M9 15l-5 5M4 16v4h4M15 15l5 5M20 16v4h-4" },
  pause: { d: "M8 5v14M16 5v14", width: 2.2 },
  play: { d: "M7 4.5l12 7.5-12 7.5z", fill: true },
  capture: { d: "M3 8h4l2-3h6l2 3h4v11H3z" + c(12, 13, 3.4) },
  screensaver: { d: "M3 4h18v12H3zM8 20h8M12 16v4M14.5 7.5a3 3 0 1 0 1.8 4.3 2.4 2.4 0 0 1-1.8-4.3z" },
  fullscreen: { d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" },
  help: { d: c(12, 12, 9.5) + "M9.4 9.2a2.7 2.7 0 1 1 3.8 2.5c-.7.3-1.2.9-1.2 1.7v.8M12 17.2v.3", width: 1.8 },
  hideUi: { d: "M3 3l18 18M10.6 5.1A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6" },
  size: { d: c(12, 12, 9) + c(12, 12, 3.5) },
  glow: { d: c(12, 12, 4) + "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" },
  color: { d: "M12 3c4 4.8 6.5 8 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 11 8 7.8 12 3z" },
  shape: { d: "M4 4h6.5v6.5H4z" + c(17.2, 7.2, 3.3) + "M7.2 14l4 6.5H3.2zM17.2 13.6l1.1 2.4 2.6.3-1.9 1.8.5 2.6-2.3-1.3-2.3 1.3.5-2.6-1.9-1.8 2.6-.3z" },
  trails: { d: c(17.5, 6.5, 3) + "M14.8 9.2L4 20M13.2 6.6L7 12.8M17.4 10.8l-6.2 6.2" },
  focus: { d: c(12, 12, 9) + c(12, 12, 4) + "M12 3v5M12 16v5M3 12h5M16 12h5" },
  hand: { d: "M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-6.5 6.5h-.5a6 6 0 0 1-5-2.7L3 14.3a1.5 1.5 0 0 1 2.5-1.6L8 15" },
  density: { d: "M5.5 6h1M11.5 6h1M17.5 6h1M5.5 12h1M11.5 12h1M17.5 12h1M5.5 18h1M11.5 18h1M17.5 18h1", width: 2.6 },
  species: { d: c(8, 8.5, 3.5) + c(16, 8.5, 3.5) + c(12, 16, 3.5) },
  sound: { d: "M3 12h1.5M7 8v8M11 4.5v15M15 7.5v9M19 10.5v3M22 12h-1", width: 1.8 },
  motion: { d: "M4 6h9M18 6h2M4 12h3M11 12h9M4 18h11M19 18h1" + c(15.5, 6, 2) + c(9, 12, 2) + c(17, 18, 2) },
  memory: { d: c(12, 12, 9) + c(12, 12, 5) + c(12, 12, 1.2) },
  life: { d: c(6, 7, 2.5) + c(18, 7, 2.5) + c(12, 18, 2.5) + "M8.3 8.2l2.6 7.6M15.7 8.2l-2.6 7.6M8.5 7h7" },
  field: { d: "M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7" },
  heat: { d: "M12 2.5c1 4 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-3 1.8-4.3 2.4-6.8 1.4 1 2.6 2.3 2.6 4.3 1.8-1.6 1.5-5.3.5-8z" },
  ecology: { d: "M5 20c0-9 6-15 15-15 0 9-6 15-15 15zM5 20l8-8" },
  visual: { d: "M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z" + c(12, 12, 3) },
  evolve: { d: "M12 21v-9M12 12L6.5 6.5M12 12l5.5-5.5" + c(5.5, 5, 2) + c(18.5, 5, 2) },
  lab: { d: "M9 3h6M10 3v6.5L4.8 18.3A2 2 0 0 0 6.5 21.3h11a2 2 0 0 0 1.7-3L14 9.5V3M7 15h10" },
  random: { d: "M4 4h16v16H4z" + "M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01", width: 2 },
  undo: { d: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" },
  reset: { d: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5" },
  close: { d: "M6 6l12 12M18 6L6 18" },
  chevron: { d: "M6 9l6 6 6-6" },
  panelLeft: { d: "M3 4h18v16H3zM9 4v16" },
  panelRight: { d: "M3 4h18v16H3zM15 4v16" },
  panelBottom: { d: "M3 4h18v16H3zM3 15h18" },
  witness: { d: "M12 2.5c1.6 2 1.6 3.8 0 5.4-1.6-1.6-1.6-3.4 0-5.4zM10 10h4v10.5h-4zM6 21h12" },
  presence: { d: c(12, 7, 3.5) + "M4.5 21a7.5 7.5 0 0 1 15 0M2 4V2h2M22 4V2h-2M2 20v2h2M22 20v2h-2" },
  exhibit: { d: "M3 5h18v12H3zM6 8h12v6H6zM8 21l4-4 4 4" },
  layout: { d: "M3 4h18v16H3zM3 9h18M9 9v11" },
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

/** A fresh inline SVG for one icon (decorative: the button carries the name). */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const spec: IconSpec = ICONS[name];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", spec.d);
  if (spec.fill) {
    path.setAttribute("fill", "currentColor");
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(spec.width ?? 1.6));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.appendChild(path);
  return svg;
}
