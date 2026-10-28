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
  /*
   * What the state means for a memory that moves (4D memory). All optional:
   * a state written before clips existed is a state that leaves time alone.
   */
  /** Seconds the moment the swarm chases trails now. */
  lag?: number;
  /** How fast that lag grows while the state holds, in seconds a second (retention). */
  lagGrowth?: number;
  /** 0..1: how far each particle forgets which moment it belongs to. */
  scatter?: number;
  /** The clip clock's rate: 1 plays, -1 rewinds. */
  clockRate?: number;
}

/** The longest a moving memory is allowed to trail its present. */
export const MAX_LAG_SECONDS = 6;

/** The time part of a state, with its defaults: a state that leaves time alone. */
export function timeOf(c: MemoryStateConfig): { lag: number; lagGrowth: number; scatter: number; clockRate: number } {
  return {
    lag: c.lag ?? 0,
    lagGrowth: c.lagGrowth ?? 0,
    scatter: c.scatter ?? 0,
    clockRate: c.clockRate ?? 1,
  };
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
    // A moving memory is followed tightly: the present, as it happens.
    lag: 0,
    scatter: 0,
    clockRate: 1,
  },
  ALIVE: {
    name: "ALIVE",
    blend: 0.5,
    memoryStrength: 2.2,
    decay: 0,
    chaos: 0.12,
    regain: 0.5,
    duration: [10, 16],
    lag: 0.1,
    scatter: 0,
    clockRate: 1,
  },
  DRIFT: {
    name: "DRIFT",
    blend: 0.78,
    memoryStrength: 0.5,
    decay: 0.22,
    chaos: 0.2,
    regain: 0,
    duration: [8, 14],
    // Retention: the moment it holds slips further behind the one that is.
    lag: 0.25,
    lagGrowth: 0.12,
    scatter: 0,
    clockRate: 1,
  },
  VOID: {
    name: "VOID",
    blend: 1.0,
    memoryStrength: 0,
    decay: 0.04,
    chaos: 0.25,
    regain: 0,
    duration: [10, 18],
    // Each particle forgets which moment it belongs to.
    lag: 0.6,
    scatter: 1,
    clockRate: 1,
  },
  REMEMBER: {
    name: "REMEMBER",
    blend: 0.12,
    memoryStrength: 5.5,
    decay: 0,
    chaos: 0.08,
    regain: 1.2,
    duration: [8, 12],
    // The clock rewinds, and the swarm finds its way back to the present.
    lag: 0,
    scatter: 0,
    clockRate: -1,
  },
};

/**
 * How much the piece has forgotten when the user holds MEMORY by hand:
 * full RECONSTRUCT strength (8) is still, no memory at all is VOID.
 */
export function manualAgitation(memoryStrength: number): number {
  const full = defaultStateConfigs.RECONSTRUCT.memoryStrength;
  return Math.min(1, Math.max(0.05, 1 - memoryStrength / full));
}

/**
 * How far life yields to a memory that moves (4D memory), by the blend.
 * A body in motion is thin where it matters, at its limbs, and a swarm's
 * cohesion beads a thin thread into droplets. Life forces add up over the
 * neighbours, so the denser the swarm, the sooner it beads: measured on the
 * walker (28 Oct 2026), RECONSTRUCT's life force (about 1.1) beaded it at
 * every density, 0.25 held it at 4,000 particles and 0.05 at 12,000. So
 * while a clip is the memory, RECONSTRUCT and REMEMBER let life go nearly
 * quiet, in proportion to the density; ALIVE keeps most of it, and by DRIFT
 * and VOID life is back at full strength.
 */
export function clipLifeYield(blend: number, count = 12000): number {
  const floor = Math.min(0.2, 600 / Math.max(1, count));
  return floor + (1 - floor) * smoothstep(Math.min(1, Math.max(0, (blend - 0.1) / 0.7)));
}

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
  /**
   * When false the authored cycle yields: state progression freezes and
   * apply() stops touching engine params — the user (or a preset) owns
   * MEMORY/LIFE directly. setState() re-engages the cycle.
   */
  active = true;
  transitionSeconds: [number, number];

  private configs: Record<MemoryStateName, MemoryStateConfig>;
  private currentName: MemoryStateName;
  private from: { blend: number; memoryStrength: number; chaos: number; lag: number; scatter: number; clockRate: number };
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
  /**
   * Life force yield: when memory dominates (blend -> 0) the particle-life
   * forces yield so the source can reconstruct; when memory is gone
   * (blend -> 1) life runs at full strength. The two systems compete.
   */
  lifeScale = 1;
  /** A moving memory's time (valid after update()): how late, how lost, and the clock's rate. */
  lag = 0;
  scatter = 0;
  clockRate = 1;

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
    this.from = this.settled(c);
    this.blend = c.blend;
    this.memoryStrength = c.memoryStrength;
    this.chaos = c.chaos;
    this.decay = c.decay;
    this.regain = c.regain;
    this.lag = this.from.lag;
    this.scatter = this.from.scatter;
    this.clockRate = this.from.clockRate;
    this.lifeScale = 0.15 + 0.85 * this.blend;
    const [tMin, tMax] = this.transitionSeconds;
    this.transitionDuration = tMin + (tMax - tMin) * this.rng();
    this.holdDuration = Math.max(
      0,
      this.pickDuration(c) - this.transitionDuration
    );
  }

  /** A state's values at rest: the origin of a transition that starts there. */
  private settled(c: MemoryStateConfig): MemorySystem["from"] {
    const t = timeOf(c);
    return { blend: c.blend, memoryStrength: c.memoryStrength, chaos: c.chaos, lag: t.lag, scatter: t.scatter, clockRate: t.clockRate };
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
    this.active = true; // forcing a state re-engages the authored cycle
    if (name === this.currentName) return;
    const previous = this.currentName;
    // Capture current interpolated values as the transition origin so a
    // manual switch mid-transition never snaps.
    this.from = {
      blend: this.blend,
      memoryStrength: this.memoryStrength,
      chaos: this.chaos,
      lag: this.lag,
      scatter: this.scatter,
      clockRate: this.clockRate,
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
      this.from = this.settled(c);
      this.blend = c.blend;
      this.memoryStrength = c.memoryStrength;
      this.chaos = c.chaos;
      this.decay = c.decay;
      this.regain = c.regain;
      this.lag = this.from.lag;
      this.scatter = this.from.scatter;
      this.clockRate = this.from.clockRate;
    }
    this.onStateChange?.(name, previous);
  }

  next(): void {
    const i = MEMORY_STATE_ORDER.indexOf(this.currentName);
    this.setState(MEMORY_STATE_ORDER[(i + 1) % MEMORY_STATE_ORDER.length]);
  }

  update(dt: number): void {
    if (!this.active) {
      // Manual control: life runs at the user's parameters, unscaled.
      this.lifeScale = 1;
      // A moving memory comes back to the present, gently: nothing snaps.
      const k = Math.exp(-Math.max(0, dt) / 1.5);
      this.lag *= k;
      this.scatter *= k;
      this.clockRate = 1 + (this.clockRate - 1) * k;
      return;
    }
    this.stateTime += dt;
    const c = this.configs[this.currentName];
    const tc = timeOf(c);
    const done = this.stateTime >= this.transitionDuration + this.holdDuration;
    // Retention grows while the state holds, from the moment it began.
    const lagNow = Math.min(MAX_LAG_SECONDS, tc.lag + tc.lagGrowth * this.stateTime);

    if (this.stateTime < this.transitionDuration) {
      const u = smoothstep(this.stateTime / this.transitionDuration);
      this.blend = this.from.blend + (c.blend - this.from.blend) * u;
      this.memoryStrength =
        this.from.memoryStrength + (c.memoryStrength - this.from.memoryStrength) * u;
      this.chaos = this.from.chaos + (c.chaos - this.from.chaos) * u;
      this.lag = this.from.lag + (lagNow - this.from.lag) * u;
      this.scatter = this.from.scatter + (tc.scatter - this.from.scatter) * u;
      this.clockRate = this.from.clockRate + (tc.clockRate - this.from.clockRate) * u;
    } else {
      this.blend = c.blend;
      this.memoryStrength = c.memoryStrength;
      this.chaos = c.chaos;
      this.lag = lagNow;
      this.scatter = tc.scatter;
      this.clockRate = tc.clockRate;
    }
    this.decay = c.decay;
    this.regain = c.regain;
    this.lifeScale = 0.15 + 0.85 * this.blend;

    if (done && this.auto) {
      this.next();
    }
  }

  /** Apply the effective memory values onto engine params. */
  apply(params: EngineParams): void {
    if (!this.active) {
      // Manual control: the user owns MEMORY, so how much the piece has
      // forgotten follows their memory strength - otherwise the medium
      // would stay at whatever the cycle last left (RECONSTRUCT's 0.05)
      // and never stir, whatever the sliders say.
      params.medium.agitation = manualAgitation(params.memory.strength);
      params.scar.erase = 0;
      return;
    }
    params.memory.strength = this.memoryStrength;
    params.memory.decay = this.decay;
    params.turbulence = Math.max(params.turbulence, this.chaos);
    // The medium stirs as the memory goes: blend is 0.05 in RECONSTRUCT, 1 in VOID.
    params.medium.agitation = this.blend;
    // Remembering clears the scars: a ramp across the state, not a switch.
    // Gray-Scott has a threshold - below it a fixed fade only shrinks the
    // pattern to a new size, above it everything dies at once - so the
    // fade rises with REMEMBER's progress and the scars withdraw over its
    // seconds (measured on the GPU: 23% of the box to 5% over 8 s).
    params.scar.erase = this.currentName === "REMEMBER" ? this.progress : 0;
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
