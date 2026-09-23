/**
 * The caption: a look's statement, spoken once, quietly, at the foot of the
 * piece. It fades in, holds, and fades out; a new line replaces the old.
 */
export interface Caption {
  readonly element: HTMLElement;
  show(text: string, seconds: number): void;
  hide(): void;
}

export function createCaption(): Caption {
  const el = document.createElement("div");
  el.id = "void-caption";
  el.setAttribute("role", "status");
  el.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:var(--caption-bottom, 150px)",
    "transform:translateX(-50%)",
    "width:min(640px,calc(100vw - 48px))",
    "text-align:center",
    "font:italic 15px/1.6 Georgia,'Times New Roman',serif",
    "letter-spacing:0.02em",
    "color:#d9d4c7",
    "text-shadow:0 0 14px #000,0 0 4px #000",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 1.6s ease",
    "z-index:95",
  ].join(";");
  let timer = 0;
  return {
    element: el,
    show(text, seconds) {
      el.textContent = text;
      el.style.opacity = "1";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (el.style.opacity = "0"), seconds * 1000);
    },
    hide() {
      window.clearTimeout(timer);
      el.style.opacity = "0";
    },
  };
}
