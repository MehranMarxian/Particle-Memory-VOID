import "./guide.css";
import { defaultStateConfigs } from "@/memory/MemorySystem";
import {
  MEMORY_STATE_GUIDE,
  SHORTCUT_GROUP_ORDER,
  SHORTCUT_ROWS,
  handleKey,
  type ShortcutContext,
  type ShortcutGroup,
} from "./shortcuts";

/**
 * The controls guide (?): a quiet overlay that explains every control by
 * meaning, grouped by what it affects. Rendered from the shared keymap, so
 * it can never document a key the app does not actually handle. The panel
 * page maps the instrument's sections — the guide explains the whole
 * surface, not only the keys.
 *
 * On a touch device the guide is also the keyboard: every key chip is
 * tappable and dispatches through the same handleKey path the physical
 * keyboard uses. bindShortcuts() wires it; until then the chips are inert.
 */
export interface GuideApi {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Mark which of the five memory states is active right now. */
  setState(name: string): void;
  /** Make every key chip run its shortcut (the touch keyboard). */
  bindShortcuts(ctx: ShortcutContext): void;
}

/** The instrument's sections, in tier order, with their one-line meaning. */
export const PANEL_SECTIONS_GUIDE: readonly { name: string; line: string }[] = [
  { name: "MOTION", line: "The five macros: memory, energy, cohesion, dissolution, atmosphere." },
  { name: "MEMORY", line: "The authored cycle, and how hard the swarm pulls toward its source." },
  { name: "LIFE", line: "The species forces: who gathers, who pushes, how far they sense." },
  { name: "FIELD", line: "The weather: turbulence, drift, gravity, wander - and your touch." },
  { name: "SCENT & HEAT", line: "The two writable memories: where it has been, where it burns." },
  { name: "ECOLOGY", line: "Predation, hunger, birth. The swarm that eats." },
  { name: "VISUAL", line: "Size, light, trails, colour and shape." },
  { name: "SOUND", line: "Listen to the room, or let the piece breathe out loud." },
  { name: "EVOLVE", line: "The search that keeps what remembers better." },
  { name: "LAB", line: "The backend, the ghost replay, the quiet modulators, the stats." },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

/** The shortcut context the key chips dispatch through; inert until bound. */
let boundContext: ShortcutContext | null = null;

function renderRow(display: string, label: string, hint: string, keys: string[]): HTMLElement {
  const row = el("div", "gd-row");
  const keyCell = el("div", "gd-keys");
  for (const key of keys) {
    const chip = el("button", "gd-key gd-key-tap") as HTMLButtonElement;
    chip.type = "button";
    chip.textContent = key === "Escape" ? "ESC" : key;
    chip.title = `Run: ${label}`;
    chip.setAttribute("aria-label", `Run shortcut: ${label}`);
    chip.addEventListener("click", () => {
      if (boundContext) handleKey(key, boundContext);
    });
    keyCell.appendChild(chip);
  }
  void display; // the chips carry the keys; the range text is theirs now
  const text = el("span", "gd-text");
  const name = el("span", "gd-label");
  name.textContent = label;
  const meaning = el("span", "gd-hint");
  meaning.textContent = hint;
  text.append(name, meaning);
  row.append(keyCell, text);
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
      column.appendChild(renderRow(row.display, row.label, row.hint, row.keys));
    }
    body.appendChild(column);
  }

  // The touch keyboard: inert until the app hands over the shortcut context.
  function bindShortcuts(ctx: ShortcutContext): void {
    boundContext = ctx;
  }

  const stateRows = new Map<string, HTMLElement>();
  const states = el("div", "gd-states");
  const statesTitle = el("div", "gd-group-title");
  statesTitle.textContent = "THE PANEL";
  states.appendChild(statesTitle);
  for (const sec of PANEL_SECTIONS_GUIDE) {
    const row = el("div", "gd-state");
    const name = el("span", "gd-state-name");
    name.textContent = sec.name;
    const line = el("span", "gd-state-line");
    line.textContent = sec.line;
    row.append(name, line);
    states.appendChild(row);
  }
  const legend = el("div", "gd-legend");
  legend.textContent = "TIER 1 IS ALWAYS VISIBLE - INSTRUMENT AND LAB OPEN FROM IT";
  states.appendChild(legend);
  body.appendChild(states);

  const memoryStates = el("div", "gd-states");
  const memoryTitle = el("div", "gd-group-title");
  memoryTitle.textContent = "MEMORY STATES";
  memoryStates.appendChild(memoryTitle);
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
    memoryStates.appendChild(row);
    stateRows.set(state.name, row);
  }
  const memoryLegend = el("div", "gd-legend");
  memoryLegend.textContent = "BAR: HOW MUCH OF THE SOURCE IS REMEMBERED";
  memoryStates.appendChild(memoryLegend);
  body.appendChild(memoryStates);

  const foot = el("div", "gd-foot");
  foot.textContent = "DRAG TO ORBIT / PINCH TO ZOOM / TAP A KEY TO RUN IT";
  card.append(head, body, foot);
  root.appendChild(card);

  let previouslyFocused: HTMLElement | null = null;

  function open(): void {
    if (!root.hidden) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    closeBtn.focus();
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  function setState(name: string): void {
    for (const [state, row] of stateRows) {
      row.classList.toggle("on", state === name);
    }
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
    setState,
    bindShortcuts,
  };
}
