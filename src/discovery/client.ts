import { paletteStops, sampleGradient } from "@/rendering/palette";
import { nameFor, type FoundLook } from "./found";
export { addFound, saveFound } from "./found";
import type { RuleGenome } from "./genome";
import type { FromWorker, ToWorker } from "./worker";

/**
 * Discovery's page side (0.13 slice 6), a lazy chunk: starts and stops the
 * worker, and gives each find its face - the released swarm seen from the
 * front, drawn as light in the find's own colours.
 */
export interface DiscoveryEvents {
  onFound(look: FoundLook): void;
  onProgress(trials: number, found: number): void;
}

let worker: Worker | null = null;

export function startDiscovery(targets: Float32Array, events: DiscoveryEvents): void {
  stopDiscovery();
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "progress") {
      events.onProgress(m.trials, m.found);
      return;
    }
    events.onFound({
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: nameFor(m.genome),
      score: m.score,
      genome: m.genome,
      thumb: thumbnail(m.dots, m.species, m.genome),
      at: Date.now(),
    });
  };
  const start: ToWorker = { type: "start", targets, seed: (Math.random() * 1e9) | 0 };
  worker.postMessage(start, [targets.buffer]);
}

export function stopDiscovery(): void {
  if (!worker) return;
  const stop: ToWorker = { type: "stop" };
  worker.postMessage(stop);
  worker.terminate();
  worker = null;
}

/** The find's colour for one species: its palette across the species, or white. */
function speciesColor(g: RuleGenome, s: number): [number, number, number] {
  if (g.look.colorMode === "monochrome") return [0.92, 0.95, 1];
  return sampleGradient(paletteStops(g.look.palette), g.species > 1 ? s / (g.species - 1) : 0.5);
}

const W = 192;
const H = 120;

function thumbnail(dots: Uint8Array, species: Uint8Array, g: RuleGenome): string {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  const colors = Array.from({ length: g.species }, (_, s) => {
    const [r, gg, b] = speciesColor(g, s);
    return `rgba(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(b * 255)},0.55)`;
  });
  const scale = (H - 8) / 256;
  for (let i = 0; i < species.length; i++) {
    ctx.fillStyle = colors[Math.min(colors.length - 1, species[i])];
    const x = W / 2 + (dots[i * 2] - 128) * scale;
    const y = H / 2 + (dots[i * 2 + 1] - 128) * scale;
    ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
  }
  return canvas.toDataURL("image/jpeg", 0.82);
}
