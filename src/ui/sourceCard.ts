import "./sourceCard.css";
import { SOURCE_FORMAT_GROUPS } from "@/sources/formats";
import { kindLabel, type SourceUiState } from "./sourceFlow";

/**
 * The YOUR MEMORY card (bottom-left): the invitation to bring a source
 * into VOID, the loaded-memory summary, and the loading / error states.
 * State changes are rare events (never per-frame), so each update simply
 * re-renders a small DOM tree. No framework, no timers.
 */
export interface SourceCardApi {
  readonly element: HTMLElement;
  update(state: SourceUiState): void;
  setThumbnail(bmp: ImageBitmap | null): void;
}

export function createSourceCard(callbacks: { onUpload(): void }): SourceCardApi {
  const root = document.createElement("div");
  root.id = "source-card";
  let thumbnail: ImageBitmap | null = null;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    n.className = cls;
    return n;
  };

  function makeCta(label: string): HTMLButtonElement {
    const b = el("button", "sc-cta");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", callbacks.onUpload);
    return b;
  }

  function drawThumb(canvas: HTMLCanvasElement): void {
    if (thumbnail) {
      canvas.width = 44;
      canvas.height = 44;
      canvas.getContext("2d")!.drawImage(thumbnail, 0, 0, 44, 44);
      canvas.style.display = "block";
    } else {
      canvas.style.display = "none";
    }
  }

  function render(state: SourceUiState): void {
    root.textContent = "";
    const inner = el("div", "sc-inner");
    const kicker = (text: string) => {
      const k = el("div", "sc-kicker");
      k.textContent = text;
      inner.appendChild(k);
    };

    if (state.phase === "empty") {
      kicker("YOUR MEMORY");
      const desc = el("p", "sc-desc");
      desc.textContent = "Drop a photograph, 3D model, or point cloud to give VOID something to remember.";
      inner.appendChild(desc);
      const list = el("ul", "sc-formats");
      for (const group of SOURCE_FORMAT_GROUPS) {
        const li = el("li", "");
        const kindSpan = el("span", "");
        kindSpan.textContent = group.label;
        const extSpan = el("span", "");
        extSpan.textContent = group.extensions.join(" ");
        li.append(kindSpan, extSpan);
        list.appendChild(li);
      }
      inner.appendChild(list);
      inner.appendChild(makeCta("UPLOAD SOURCE"));
      const drop = el("div", "sc-drop");
      drop.textContent = "or drop a file anywhere";
      inner.appendChild(drop);
    } else if (state.phase === "loading") {
      kicker("YOUR MEMORY");
      const status = el("div", "sc-status");
      status.textContent = state.stage === "reading" ? `READING ${state.name}...` : "FORMING THE MEMORY...";
      inner.appendChild(status);
      const note = el("div", "sc-drop");
      note.textContent = state.hadValid ? "THE CURRENT MEMORY KEEPS RUNNING" : "VOID IS WAITING";
      inner.appendChild(note);
    } else if (state.phase === "error") {
      kicker("MEMORY");
      const status = el("div", "sc-status");
      const err = el("div", "sc-error");
      err.textContent = state.message;
      const note = el("div", "");
      note.textContent = state.hadValid ? "THE PREVIOUS MEMORY IS STILL HELD" : "VOID REMEMBERS NOTHING YET";
      status.append(err, note);
      inner.appendChild(status);
      inner.appendChild(makeCta("TRY AGAIN"));
    } else {
      kicker("MEMORY");
      const meta = el("div", "sc-meta");
      const canvas = el("canvas", "sc-thumb");
      const info = el("div", "sc-info");
      const name = el("div", "sc-name");
      name.textContent = state.name;
      name.title = state.name;
      const sub = el("div", "sc-sub");
      sub.textContent = `${kindLabel(state.kind)} · ${state.count.toLocaleString()} PARTICLES`;
      info.append(name, sub);
      meta.append(canvas, info);
      inner.appendChild(meta);
      inner.appendChild(makeCta("CHANGE SOURCE"));
      drawThumb(canvas);
    }
    root.appendChild(inner);
  }

  render({ phase: "empty" });

  return {
    element: root,
    update(state) {
      render(state);
    },
    setThumbnail(bmp) {
      thumbnail = bmp;
      const canvas = root.querySelector<HTMLCanvasElement>(".sc-thumb");
      if (canvas) drawThumb(canvas);
    },
  };
}
