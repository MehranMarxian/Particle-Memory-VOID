import type { EngineParams } from "@/types";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import type { ParticleEngine } from "@/particles/ParticleEngine";
import type { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { EcologySystem, defaultEcologyParams, type EcologyParams, type EcologyView } from "@/ecology/ecologySystem";
import { ecologyDriveFromAudio, initialOnset } from "@/ecology/ecologyAudio";
import type { AudioBands } from "@/audio/audioReactive";
import { sampleLife } from "@/particles/lifeCycle";
import { FIXED_DT } from "./stepper";
import type { SimEngine } from "./host";

export interface EcologyStage {
  readonly engine: SimEngine;
  readonly renderer: ParticleRenderer | null;
  readonly params: EngineParams;
  readonly speciesCount: number;
  readonly matrix: InteractionMatrix;
  readonly backend: "gpu" | "cpu";
  /** Births and deaths reorder particles; the look is re-baked after. */
  applyLook(): void;
}

/** Swap `stride` elements of two slots in a flat per-particle array. */
export function swapSlots(array: Float32Array, a: number, b: number, stride: number): void {
  for (let k = 0; k < stride; k++) {
    const ia = a * stride + k;
    const ib = b * stride + k;
    const tmp = array[ia];
    array[ia] = array[ib];
    array[ib] = tmp;
  }
}

/**
 * Predation, population and mortality, hosted on the running engine.
 *
 * CPU backend only, on purpose: death and birth need allocation and
 * scatter, which is the kind of bookkeeping the CPU already owns for the
 * grid. The GPU path keeps its behaviour and says so.
 */
export class EcologyHost {
  readonly params: EcologyParams = defaultEcologyParams();
  readonly events = { births: 0, deaths: 0 };
  private drive = { aggression: 1, satiationBias: 0, panic: 0 };
  private onset = initialOnset();
  private system: EcologySystem | null = null;
  private view: EcologyView | null = null;

  constructor(private readonly stage: EcologyStage) {}

  /** Point the ecology at the current engine's buffers. Called on every build. */
  install(): void {
    // The union type does not promise mass or a grid query: those belong to the
    // CPU engine, which is the only backend the ecology runs on.
    const cpu = this.stage.engine as unknown as ParticleEngine;
    this.system = new EcologySystem(cpu.capacity);
    this.system.reset(cpu.count);
    this.view = {
      count: cpu.count,
      capacity: cpu.capacity,
      speciesCount: this.stage.speciesCount,
      species: cpu.species,
      positions: cpu.positions,
      velocities: cpu.velocities,
      mass: cpu.mass,
    };
    this.events.births = 0;
    this.events.deaths = 0;
  }

  /** Let the room drive the hunt (when the ecology listens). */
  listen(bands: AudioBands, sensitivity: number, dt: number): void {
    if (!this.params.audioReactive) return;
    const mapped = ecologyDriveFromAudio(bands, this.onset, sensitivity, dt);
    this.drive = mapped.drive;
    this.onset = mapped.state;
  }

  /** One ecology step. Does nothing unless it is switched on. */
  step(dt: number): void {
    const { stage, events } = this;
    if (!this.params.enabled || !this.system || !this.view) return;
    if (stage.backend !== "cpu") return;
    const engine = stage.engine;
    const renderer = stage.renderer;
    const params = stage.params;
    const view = this.view;
    view.count = engine.count;
    view.speciesCount = stage.speciesCount;
    this.system.step({
      dt,
      matrix: stage.matrix,
      params: this.params,
      view,
      hooks: {
        swap(a, b) {
          // The system swaps species/position/velocity/mass itself. This covers
          // the per-particle state that lives outside the engine.
          swapSlots(engine.renderState, a, b, 4);
          swapSlots(engine.memoryPerParticle, a, b, 1);
          swapSlots(engine.targets, a, b, 3);
          if (renderer) {
            swapSlots(renderer.lifeBuffer, a, b, 1);
            swapSlots(renderer.shapeBuffer, a, b, 1);
          }
        },
        onBirth() {
          events.births++;
        },
        onDeath() {
          events.deaths++;
        },
      },
      neighbors: (i, radius, visit) => (engine as unknown as ParticleEngine).forEachNeighbor(i, radius, visit),
      // Age as the life cycle defines it: 0 at birth, 1 spent. This used to
      // read the renderer's life buffer, which tied an ecology concept to a
      // rendering buffer: all 1s whenever the life cycle is off (so nothing
      // ever died of age) and above 1 for newborns (so ageOf went negative).
      ageOf: (i) =>
        params.lifecycle.enabled
          ? Math.min(
              1,
              sampleLife(i, engine.simTime, params.lifecycle, FIXED_DT).age / Math.max(1, params.lifecycle.lifespan)
            )
          : 0,
      rng: Math.random,
      drive: this.drive,
    });
    engine.count = view.count;
    renderer?.setCount(view.count);
    renderer?.markLifeDirty();
    stage.applyLook();
  }
}
