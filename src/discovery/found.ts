import type { RuleGenome } from "./genome";

/**
 * The Found row (0.13 slice 6): the looks Discovery kept, remembered in
 * this browser. Small and eager - the row shows at boot - while the search
 * itself is a lazy chunk and a worker.
 */
export interface FoundLook {
  id: string;
  name: string;
  score: number;
  genome: RuleGenome;
  /** A JPEG data URL: the released swarm from the front. */
  thumb: string;
  /** When it was found (ms since 1970). */
  at: number;
}

export const FOUND_KEY = "void.found.v1";
/** The row keeps this many (Mehran: four is enough); a better find replaces the weakest. */
export const FOUND_MAX = 4;

/** Add a find. Full row: it replaces the weakest, if it is better; otherwise the row is unchanged. */
export function addFound(list: readonly FoundLook[], item: FoundLook): FoundLook[] {
  if (list.length < FOUND_MAX) return [...list, item];
  let weakest = 0;
  for (let i = 1; i < list.length; i++) if (list[i].score < list[weakest].score) weakest = i;
  if (item.score <= list[weakest].score) return [...list];
  const out = [...list];
  out.splice(weakest, 1);
  out.push(item);
  return out;
}

const ADJECTIVES = [
  "Slow", "Bright", "Hollow", "Quiet", "Restless", "Folded", "Distant", "Tender", "Broken", "Patient",
  "Salt", "Glass", "Ember", "Ashen", "Lunar", "Drowned", "Woven", "Feral", "Pale", "Hidden",
];
const NOUNS = [
  "Tide", "Choir", "Orchard", "Lantern", "Harbour", "Migration", "Weather", "Hymn", "Archive", "Garden",
  "Current", "Vigil", "Murmur", "Embers", "Tributary", "Reliquary", "Swarm", "Chorus", "Threshold", "Field",
];

/** A name from the genome itself, so the same find is always called the same. */
export function nameFor(g: RuleGenome): string {
  let h = 2166136261;
  const feed = (v: number) => {
    h ^= Math.round(v * 1e6);
    h = Math.imul(h, 16777619);
  };
  g.matrix.forEach(feed);
  Object.values(g.genes).forEach(feed);
  feed(g.species);
  const u = h >>> 0;
  return `${ADJECTIVES[u % ADJECTIVES.length]} ${NOUNS[Math.floor(u / ADJECTIVES.length) % NOUNS.length]}`;
}

function isFound(x: unknown): x is FoundLook {
  const f = x as FoundLook;
  return (
    !!f &&
    typeof f.id === "string" &&
    typeof f.name === "string" &&
    typeof f.score === "number" &&
    typeof f.thumb === "string" &&
    f.thumb.startsWith("data:image/") &&
    !!f.genome &&
    typeof f.genome.species === "number" &&
    Array.isArray(f.genome.matrix) &&
    f.genome.matrix.length === f.genome.species * f.genome.species
  );
}

export function loadFound(storage: Pick<Storage, "getItem"> | null = safeStorage()): FoundLook[] {
  try {
    const raw = storage?.getItem(FOUND_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    // A longer list (saved before the row held four) keeps its best, in the order found.
    const valid = list.filter(isFound);
    const best = new Set([...valid].sort((x, y) => y.score - x.score).slice(0, FOUND_MAX));
    return valid.filter((f) => best.has(f));
  } catch {
    return [];
  }
}

export function saveFound(list: readonly FoundLook[], storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(FOUND_KEY, JSON.stringify(list));
  } catch {
    // Private mode or full: the row lasts this visit.
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
