import { SECONDS_PER_HUNGER_DEATH } from "@/app/witness";

/**
 * The Witness line: a quiet count at the top of the piece while the Witness
 * look plays. No red, no alarm - the number is the whole statement.
 */
export interface WitnessOverlay {
  readonly element: HTMLElement;
  show(statement: string): void;
  hide(): void;
  setCount(lost: number): void;
}

export function createWitnessOverlay(): WitnessOverlay {
  const el = document.createElement("div");
  el.id = "witness";
  el.hidden = true;
  el.setAttribute("role", "status");
  el.style.cssText = [
    "position:fixed",
    "top:72px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:90",
    "text-align:center",
    "pointer-events:none",
    "font:11px/1.7 ui-monospace,monospace",
    "letter-spacing:0.22em",
    "color:#cbbf9f",
    "text-shadow:0 0 12px rgba(0,0,0,0.9)",
    "padding:14px 48px 18px",
    "background:radial-gradient(ellipse at center, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0) 72%)",
    "width:min(760px,calc(100vw - 32px))",
    "box-sizing:border-box",
  ].join(";");
  const count = document.createElement("div");
  count.style.cssText = "font-size:26px;letter-spacing:0.12em;color:#f2e6c8;font-variant-numeric:tabular-nums";
  const line = document.createElement("div");
  const note = document.createElement("div");
  note.style.cssText = "margin-top:6px;letter-spacing:0.06em;color:#7d7461;font-size:10px";
  el.append(count, line, note);

  return {
    element: el,
    show(statement) {
      note.textContent = statement;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    setCount(lost) {
      count.textContent = lost.toLocaleString();
      line.textContent =
        lost === 1
          ? "PERSON HAS DIED OF HUNGER SINCE YOU BEGAN WATCHING"
          : `PEOPLE HAVE DIED OF HUNGER SINCE YOU BEGAN WATCHING · ONE EVERY ${SECONDS_PER_HUNGER_DEATH} SECONDS`;
    },
  };
}
