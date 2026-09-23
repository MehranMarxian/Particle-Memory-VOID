import type { EngineParams } from "@/types";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import type { MemorySystem } from "@/memory/MemorySystem";
import type { VisualSettings } from "@/rendering/VisualSettings";
import type { PanelApi } from "@/ui/panel";
import type { Caption } from "@/ui/caption";

/** The subset of engine behavior the app layer needs (CPU or GPU backend). */
export interface SimEngine {
  /** The two stigmergic fields, which the field ramp axis samples on the CPU. */
  readonly scent: { sample(x: number, y: number, z: number): number; peak(): number };
  readonly heat: { sample(x: number, y: number, z: number): number; peak(): number };
  count: number;
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  targets: Float32Array;
  species: Uint8Array;
  memoryPerParticle: Float32Array;
  renderState: Float32Array;
  lastStepTime: number;
  simTime: number;
  /** Sync GPU readbacks the last step performed (the budget tripwire). */
  readonly lastReadbacks: { count: number; bytes: number };
  configureGrid(params: EngineParams): void;
  step(dt: number, params: EngineParams, matrix: InteractionMatrix): void;
  regainMemory(dt: number, rate: number): void;
  restoreMemory(): void;
  setSpeciesCount(matrix: InteractionMatrix, n: number): void;
  meanTargetDistance(): number;
  /** Ring the swarm: a ripple wavefront born at the pointer, stamped with simTime. */
  spawnRipple(x: number, y: number, z: number): void;
  /** GPU only: push `targets` to the target texture after a live retarget. */
  uploadTargets?(): void;
}

/**
 * What the app's parts may touch of the running piece. main.ts owns the
 * state and builds this once, as live getters over it: an engine rebuild or
 * a panel created later is seen by every part without re-wiring. Parts get
 * the narrowest view that does their job, and nothing reaches back into
 * main.ts except through here.
 */
export interface AppHost {
  readonly engine: SimEngine;
  readonly panel: PanelApi | null;
  readonly params: EngineParams;
  readonly visual: VisualSettings;
  readonly memory: MemorySystem;
  readonly caption: Caption;
  flashHint(text: string, seconds?: number, sticky?: boolean): void;
  /** Re-bake colour and shape for the current look. */
  applyLook(): void;
  /** Re-bake colour alone (cheaper; shapes did not change). */
  applyLookColors(): void;
}
