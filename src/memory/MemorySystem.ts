import type { EngineParams } from "@/types";
import { smoothstep } from "@/utils/math";
import { mulberry32 } from "@/utils/math";

/**
 * The five memory states of VOID / PARTICLE MEMORY.
 *
 * RECONSTRUCT  particles converge on the source
 * ALIVE        memory and particle life are balanced
 * DRIFT        memory strength gradually decreases, particles forget
 * VOID         memory almost disabled, abstract particle ecosystem
 * REMEMBER     memory rises again, the source reconstructs itself
 */
export type MemoryStateName =
  | "RECONSTRUCT"
  | "ALIVE"
  | "DRIFT"
  | "VOID"
  | "REMEMBER";

export const MEMORY_STATE_ORDER: MemoryStateName[] = [
  "RECONSTRUCT",
  "ALIVE",
  "DRIFT",
  "VOID",
  "REMEMBER",
];

export interface MemoryStateConfig {
  name: MemoryStateName;
  /** Master MEMORY<->LIFE blend: 0 = full memory, 1 = pure particle life. */
  blend: number;
  /** Memory spring strength while in this state. */
  memoryStrength: number;
  /** Per-particle stochastic forgetting rate (0..~3). */
  decay: number;
  /** Extra turbulence/chaos while in this state. */
  chaos: number;
  /** Rate at which forgotten particles regain memory (REMEMBER). */
  regain: number;
  /** Duration range in seconds [min, max] for the automatic cycle. */
  duration: [number, number];
}

export const defaultStateConfigs: Record<MemoryStateName, MemoryStateConfig> = {
  RECONSTRUCT: {
    name: "RECONSTRUCT",
    blend: 0.05,
    memoryStrength: 8,
    decay: 0,
    chaos: 0.05,
    regain: 1.5,
    duration: [8, 12],
  },
  ALIVE: {
    name: "ALIVE",
    blend: 0.5,
    memoryStrength: 2.2,
    decay: 0,
    chaos: 0.12,
    regain: 0.5,
    duration: [10, 16],
  },
  DRIFT: {
    name: "DRIFT",
    blend: 0.78,
    memoryStrength: 0.5,
    decay: 0.22,
    chaos: 0.2,
    regain: 0,
    duration: [8, 14],
  },
  VOID: {
    name: "VOID",
    blend: 1.0,
    memoryStrength: 0,
    decay: 0.04,
    chaos: 0.25,
    regain: 0,
    duration: [10, 18],
  },
  REMEMBER: {
    name: "REMEMBER",
    blend: 0.12,
    memoryStrength: 5.5,
    decay: 0,
    chaos: 0.08,
    regain: 1.2,
    duration: [8, 12],
  },
};

/** Serialized cycle configuration (JSON-friendly). */
export interface MemoryCyclePreset {
  transitionSeconds: [number, number];
  states: MemoryStateConfig[];
}

const defaultTransition: [number, number] = [4, 7];

/**
 * Drives the MEMORY<->LIFE master parameter through the five states with
 * smooth (smoothstep) transitions and slightly irregular automatic timing.
 *
 * The system never changes EngineParams directly; each update() produces the
 * effective values (blend, memoryStrength, decay, chaos, regain) that the
 * app applies to the engine. This keeps the state machine pure and testable.
 */
export class MemorySystem {
  auto: boolean;
  transitionSeconds: [number, number];

  private configs: Record<MemoryStateName, MemoryStateConfig>;
  private currentName: MemoryStateName;
  private from: { blend: number; memoryStrength: number; chaos: number };
  private stateTime = 0;
  private transitionDuration: number;
  private holdDuration: number;
  private rng: () => number;

  onStateChange?: (name: MemoryStateName, previous: MemoryStateName) => void;

  // Effective interpolated values (valid after update()).
  blend: number;
  memoryStrength: number;
  chaos: number;
  decay: number;
  regain: number;

  constructor(options?: {
    configs?: Partial<Record<MemoryStateName, Partial<MemoryStateConfig>>>;
    transitionSeconds?: [number, number];
    auto?: boolean;
    seed?: number;
    startState?: MemoryStateName;
  }) {
    this.configs = { ...defaultStateConfigs };
    if (options?.configs) {
      for (const [name, patch] of Object.entries(options.configs)) {
        this.configs[name as MemoryStateName] = {
          ...this.configs[name as MemoryStateName],
          ...patch,
        } as MemoryStateConfig;
      }
    }
    this.transitionSeconds = options?.transitionSeconds ?? defaultTransition;
    this.auto = options?.auto ?? true;
    this.rng = mulberry32(options?.seed ?? 20471);

    const start = options?.startState ?? "RECONSTRUCT";
    this.currentName = start;
    const c = this.configs[start];
    this.from = { blend: c.blend, memoryStrength: c.memoryStrength, chaos: c.chaos };
    this.blend = c.blend;
    this.memoryStrength = c.memoryStrength;
    this.chaos = c.chaos;
    this.decay = c.decay;
    this.regain = c.regain;
    const [tMin, tMax] = this.transitionSeconds;
    this.transitionDuration = tMin + (tMax - tMin) * this.rng();
    this.holdDuration = Math.max(
      0,
      this.pickDuration(c) - this.transitionDuration
    );
  }

  get state(): MemoryStateName {
    return this.currentName;
  }

  get config(): MemoryStateConfig {
    return this.configs[this.currentName];
  }

  /** 0..1 progress through the current state (including transition). */
  get progress(): number {
    const total = this.transitionDuration + this.holdDuration;
    return total > 0 ? Math.min(1, this.stateTime / total) : 1;
  }

  get transitioning(): boolean {
    return this.stateTime < this.transitionDuration;
  }

  private pickDuration(c: MemoryStateConfig): number {
    const [min, max] = c.duration;
    return min + (max - min) * this.rng();
  }

  setState(name: MemoryStateName, immediate = false): void {
    if (!this.configs[name]) throw new Error(`unknown memory state: ${name}`);
    if (name === this.currentName) return;
    const previous = this.currentName;
    // Capture current interpolated values as the transition origin so a
    // manual switch mid-transition never snaps.
    this.from = {
      blend: this.blend,
      memoryStrength: this.memoryStrength,
      chaos: this.chaos,
    };
    this.currentName = name;
    this.stateTime = 0;
    const c = this.configs[name];
    const [tMin, tMax] = this.transitionSeconds;
    this.transitionDuration = tMin + (tMax - tMin) * this.rng();
    this.holdDuration = Math.max(0, this.pickDuration(c) - this.transitionDuration);
    if (immediate) {
      this.transitionDuration = 0;
      this.holdDuration = this.pickDuration(c);
      this.from = { blend: c.blend, memoryStrength: c.memoryStrength, chaos: c.chaos };
      this.blend = c.blend;
      this.memoryStrength = c.memoryStrength;
      this.chaos = c.chaos;
      this.decay = c.decay;
      this.regain = c.regain;
    }
    this.onStateChange?.(name, previous);
  }

  next(): void {
    const i = MEMORY_STATE_ORDER.indexOf(this.currentName);
    this.setState(MEMORY_STATE_ORDER[(i + 1) % MEMORY_STATE_ORDER.length]);
  }

  update(dt: number): void {
    this.stateTime += dt;
    const c = this.configs[this.currentName];
    const done = this.stateTime >= this.transitionDuration + this.holdDuration;

    if (this.stateTime < this.transitionDuration) {
      const u = smoothstep(this.stateTime / this.transitionDuration);
      this.blend = this.from.blend + (c.blend - this.from.blend) * u;
      this.memoryStrength =
        this.from.memoryStrength + (c.memoryStrength - this.from.memoryStrength) * u;
      this.chaos = this.from.chaos + (c.chaos - this.from.chaos) * u;
    } else {
      this.blend = c.blend;
      this.memoryStrength = c.memoryStrength;
      this.chaos = c.chaos;
    }
    this.decay = c.decay;
    this.regain = c.regain;

    if (done && this.auto) {
      this.next();
    }
  }

  /** Apply the effective memory values onto engine params. */
  apply(params: EngineParams): void {
    params.memory.strength = this.memoryStrength;
    params.memory.decay = this.decay;
    params.turbulence = Math.max(params.turbulence, this.chaos);
  }

  toJSON(): MemoryCyclePreset {
    return {
      transitionSeconds: [...this.transitionSeconds] as [number, number],
      states: MEMORY_STATE_ORDER.map((n) => ({ ...this.configs[n] })),
    };
  }

  static fromJSON(json: MemoryCyclePreset): MemorySystem {
    const configs: Partial<Record<MemoryStateName, Partial<MemoryStateConfig>>> = {};
    for (const s of json.states) configs[s.name] = s;
    return new MemorySystem({
      configs,
      transitionSeconds: json.transitionSeconds,
      auto: true,
    });
  }
}
