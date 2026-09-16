import "./guide.css";
import { defaultStateConfigs } from "@/memory/MemorySystem";
import {
  MEMORY_STATE_GUIDE,
  SHORTCUT_GROUP_ORDER,
  SHORTCUT_ROWS,
  type ShortcutGroup,
} from "./shortcuts";

/**
 * The controls guide (?): a quiet overlay that explains every control by
 * meaning, grouped by what it affects. Rendered from the shared keymap, so
 * it can never document a key the app does not actually handle.
 */
export interface GuideApi {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function renderRow(display: string, label: string, hint: string): HTMLElement {
  const row = el("div", "gd-row");
  const key = el("span", "gd-key");
  key.textContent = display;
  const text = el("span", "gd-text");
  const name = el("span", "gd-label");
  name.textContent = label;
  const meaning = el("span", "gd-hint");
  meaning.textContent = hint;
  text.append(name, meaning);
  row.append(key, text);
  return row;
}

export function createControlsGuide(): GuideApi {
  const root = el("div", "gd-root");
  root.id = "guide";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-label", "Controls");

  const card = el("div", "gd-card");

  const head = el("div", "gd-head");
  const title = el("span", "gd-title");
  title.textContent = "CONTROLS";
  const hint = el("span", "gd-esc");
  hint.textContent = "ESC";
  const closeBtn = el("button", "gd-close");
  closeBtn.type = "button";
  closeBtn.textContent = "CLOSE";
  head.append(title, hint, closeBtn);

  const body = el("div", "gd-body");
  for (const group of SHORTCUT_GROUP_ORDER) {
    const column = el("div", "gd-group");
    const heading = el("div", "gd-group-title");
    heading.textContent = group;
    column.appendChild(heading);
    for (const row of SHORTCUT_ROWS.filter((r) => r.group === (group as ShortcutGroup))) {
      column.appendChild(renderRow(row.display, row.label, row.hint));
    }
    body.appendChild(column);
  }

  const states = el("div", "gd-states");
  const statesTitle = el("div", "gd-group-title");
  statesTitle.textContent = "MEMORY STATES";
  states.appendChild(statesTitle);
  for (const state of MEMORY_STATE_GUIDE) {
    const row = el("div", "gd-state");
    const name = el("span", "gd-state-name");
    name.textContent = state.name;
    const bar = el("span", "gd-bar");
    const fill = document.createElement("i");
    const blend = defaultStateConfigs[state.name].blend;
    fill.style.width = `${Math.round((1 - blend) * 100)}%`;
    bar.appendChild(fill);
    const line = el("span", "gd-state-line");
    line.textContent = state.line;
    row.append(name, bar, line);
    states.appendChild(row);
  }
  const legend = el("div", "gd-legend");
  legend.textContent = "BAR: HOW MUCH OF THE SOURCE IS REMEMBERED";
  states.appendChild(legend);
  body.appendChild(states);

  const foot = el("div", "gd-foot");
  foot.textContent = "DRAG TO ORBIT / SCROLL TO ZOOM";
  card.append(head, body, foot);
  root.appendChild(card);

  function open(): void {
    if (!root.hidden) return;
    root.hidden = false;
    closeBtn.focus();
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
  }

  closeBtn.addEventListener("click", () => close());
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });

  return {
    element: root,
    open,
    close,
    toggle: () => {
      if (root.hidden) open();
      else close();
    },
    isOpen: () => !root.hidden,
  };
}
