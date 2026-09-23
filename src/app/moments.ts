import type { VisualSettings } from "@/rendering/VisualSettings";
import { mulberry32 } from "@/utils/math";
import { statementFor } from "@/presets/statements";
import { createPresenceCamera, PresenceModel, silhouetteSource, type PresenceCamera } from "@/input/presence";
import { createWitnessOverlay, type WitnessOverlay } from "@/ui/witnessOverlay";
import { Genesis } from "./genesis";
import { Witness } from "./witness";
import { Exhibition, type ExhibitionCue } from "./exhibition";
import type { AppHost, SimEngine } from "./host";

/**
 * The moments (v0.11): the four things the piece does as performances
 * rather than parameters - GENESIS, WITNESS, PRESENCE and EXHIBITION. The
 * scores and models live in their own pure modules (genesis.ts,
 * witness.ts, input/presence.ts, exhibition.ts); these directors perform
 * them on the running piece through the AppHost.
 */

// --- GENESIS -------------------------------------------------------------------

export class GenesisDirector {
  private readonly score = new Genesis();
  /** The look Genesis borrowed for its fire, given back when it settles. */
  private saved: { visual: VisualSettings; ripple: number } | null = null;

  constructor(private readonly host: AppHost) {}

  get active(): boolean {
    return this.score.active;
  }

  start(): void {
    if (this.score.active) return;
    this.score.start();
    this.host.flashHint("GENESIS - THE MEMORY BURNS AND IS REBORN", 5);
  }

  /** A look change mid-Genesis wins: the fire is not allowed to restore over it. */
  cancel(): void {
    this.score.active = false;
    this.saved = null;
  }

  step(dt: number): void {
    const { host } = this;
    const { memory, visual, params } = host;
    for (const cue of this.score.tick(dt)) {
      if (cue === "release") {
        memory.setState("VOID");
        host.panel?.setState(memory.state);
      } else if (cue === "ignite") {
        this.saved = { visual: { ...visual }, ripple: params.pointer.ripple };
        Object.assign(visual, {
          colorMode: "gradient",
          gradientPalette: "EMBER",
          gradientAxis: "radial",
          trails: true,
          trailDecay: Math.max(visual.trailDecay, 0.86),
          glow: Math.max(visual.glow, 0.8),
        });
        params.pointer.ripple = Math.max(params.pointer.ripple, 1.8);
        host.applyLook();
        host.panel?.refresh();
      } else if (cue === "ring") {
        // Every wavefront is born at the heart of the subject.
        host.engine.spawnRipple(0, 0, 0);
      } else if (cue === "reconstruct") {
        memory.setState("RECONSTRUCT");
        host.engine.restoreMemory();
        host.panel?.setState(memory.state);
      } else if (cue === "settle" && this.saved) {
        Object.assign(visual, this.saved.visual);
        params.pointer.ripple = this.saved.ripple;
        this.saved = null;
        host.applyLook();
        host.panel?.refresh();
      }
    }
  }
}

// --- WITNESS -------------------------------------------------------------------

/** Fixed, so the same particles are the same people across a density change. */
const WITNESS_SEED = 0x5eed;

export class WitnessDirector {
  readonly witness = new Witness();
  readonly overlay: WitnessOverlay = createWitnessOverlay();
  private lastNow = performance.now();

  constructor(private readonly host: AppHost) {}

  get enabled(): boolean {
    return this.witness.enabled;
  }

  begin(statement: string): void {
    this.witness.enabled = true;
    this.witness.begin(this.host.engine.count, WITNESS_SEED);
    this.lastNow = performance.now();
    this.overlay.setCount(0);
    this.overlay.show(statement);
  }

  end(): void {
    if (!this.witness.enabled) return;
    this.witness.enabled = false;
    this.overlay.hide();
  }

  /** A rebuilt crowd keeps its losses (called on every engine build). */
  resize(count: number): void {
    this.witness.resize(count, WITNESS_SEED);
  }

  /** Darken the lost in a freshly baked colour buffer. */
  applyTo(colors: Float32Array, count: number): void {
    this.witness.applyTo(colors, count);
  }

  /** Wall time, not sim time: the world does not pause when the piece does. */
  step(now: number): void {
    if (!this.witness.enabled) return;
    const dt = Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const lost = this.witness.tick(dt);
    if (lost.length === 0) return;
    // Each absence sends one quiet wave through the crowd.
    const engine = this.host.engine;
    const i = lost[lost.length - 1];
    const p = engine.positions;
    if (i < engine.count) engine.spawnRipple(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    this.host.applyLookColors();
    this.overlay.setCount(this.witness.lost);
  }
}

// --- PRESENCE ------------------------------------------------------------------

const PRESENCE_FRAME_SECONDS = 1 / 12;
const PRESENCE_SHAPE_SECONDS = 0.4;

export class PresenceDirector {
  /** The visitor's camera switch, shared with the panel's YOU tool. */
  readonly state = { enabled: false };
  private readonly model = new PresenceModel();
  private cam: PresenceCamera | null = null;
  /** The memory's own targets, kept while a visitor borrows the swarm. */
  private home: Float32Array | null = null;
  /** The engine the kept home belongs to: a rebuild makes the old home stale. */
  private homeEngine: SimEngine | null = null;
  private was = this.model.state;
  private frameClock = 0;
  private shapeClock = 0;

  constructor(private readonly host: AppHost) {}

  async toggle(): Promise<void> {
    const { host } = this;
    if (this.state.enabled) {
      this.stop();
      host.flashHint("PRESENCE: OFF - THE CAMERA IS CLOSED", 3);
      return;
    }
    this.state.enabled = true;
    host.panel?.refresh();
    try {
      this.cam = await createPresenceCamera();
      this.model.reset();
      this.was = this.model.state;
      host.flashHint("PRESENCE: LEARNING THE EMPTY ROOM - STEP ASIDE FOR A MOMENT", 5);
    } catch (err) {
      this.state.enabled = false;
      this.cam = null;
      host.panel?.refresh();
      const denied = (err as Error)?.name === "NotAllowedError";
      host.flashHint(denied ? "PRESENCE NEEDS THE CAMERA - PERMISSION WAS NOT GIVEN" : "NO CAMERA AVAILABLE FOR PRESENCE", 6);
    }
  }

  stop(): void {
    this.cam?.stop();
    this.cam = null;
    this.state.enabled = false;
    this.releaseVisitor();
    this.host.panel?.refresh();
  }

  /** Give the swarm back its own memory. */
  private releaseVisitor(): void {
    if (!this.home) return;
    const engine = this.host.engine;
    engine.targets.set(this.home.subarray(0, engine.count * 3));
    engine.uploadTargets?.();
    this.home = null;
  }

  step(dt: number): void {
    if (!this.cam) return;
    const { host, model } = this;
    const engine = host.engine;
    if (this.homeEngine !== engine) {
      this.home = null;
      this.homeEngine = engine;
    }
    this.frameClock += dt;
    if (this.frameClock < PRESENCE_FRAME_SECONDS) return;
    const frameDt = this.frameClock;
    this.frameClock = 0;
    const grey = this.cam.grab();
    if (!grey) return;
    const state = model.update(grey, frameDt);
    if (state === "present") {
      if (this.was !== "present") {
        // Someone arrived: the swarm turns toward them at once.
        this.shapeClock = PRESENCE_SHAPE_SECONDS;
        host.memory.setState("RECONSTRUCT");
        host.panel?.setState(host.memory.state);
        const line = statementFor("presence");
        if (line) host.caption.show(line, 8);
      }
      this.shapeClock += frameDt;
      if (this.shapeClock >= PRESENCE_SHAPE_SECONDS) {
        this.shapeClock = 0;
        // A fixed seed keeps each particle's place in the silhouette steady
        // from one frame to the next, so the visitor breathes, not flickers.
        const shape = silhouetteSource(model.mask, model.w, model.h, engine.count, mulberry32(77));
        if (shape) {
          if (!this.home) this.home = engine.targets.slice(0, engine.count * 3);
          engine.targets.set(shape.positions);
          engine.uploadTargets?.();
        }
      }
    } else if (this.was === "present") {
      // They walked away: the swarm lets them go and finds its own memory.
      this.releaseVisitor();
      host.memory.setState("REMEMBER");
      host.panel?.setState(host.memory.state);
    }
    this.was = state;
  }
}

// --- EXHIBITION ----------------------------------------------------------------

export interface ExhibitionStage {
  /** Is the screensaver (the room) running? */
  saverActive(): boolean;
  enterSaver(): void;
  applyLookByName(name: string, captionSeconds: number): void;
  startGenesis(): void;
}

export class ExhibitionDirector {
  private readonly programme = new Exhibition();
  private lastNow = 0;

  constructor(
    private readonly host: AppHost,
    private readonly stage: ExhibitionStage
  ) {}

  get running(): boolean {
    return this.programme.running;
  }

  start(): void {
    if (this.programme.running) return;
    // Not awaited: the screensaver is active at once, and fullscreen may
    // take its time (or never answer, inside an embed).
    if (!this.stage.saverActive()) this.stage.enterSaver();
    this.lastNow = performance.now();
    this.play(this.programme.start());
  }

  private play(cue: ExhibitionCue): void {
    this.stage.applyLookByName(cue.look, Math.max(6, cue.seconds - 3));
    if (cue.genesis) this.stage.startGenesis();
  }

  step(now: number): void {
    if (!this.programme.running) return;
    if (!this.stage.saverActive()) {
      // Any input ended the screensaver, and with it the programme.
      this.programme.stop();
      this.host.caption.hide();
      return;
    }
    const dt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    const cue = this.programme.tick(dt);
    if (cue) this.play(cue);
  }
}
