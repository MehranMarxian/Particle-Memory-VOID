import * as THREE from "three";
import type { EngineParams } from "@/types";
import { breatheOffset, cameraPose, type CameraChoreography } from "@/rendering/cameraChoreography";
import { ghostLissajous, PointerInfluence, PointerTrack } from "@/input/pointerForce";
import { GestureTracker } from "@/input/touchGestures";
import type { SimEngine } from "./host";

type Ndc = { x: number; y: number };

/**
 * The orbit rig: the camera circles a target. The editor keeps its own slow
 * orbit and the viewer's radius; the screensaver follows the active look's
 * choreography. Two-finger pan moves the target in the camera's own plane.
 */
export class OrbitRig {
  azimuth = 0;
  elevation = 0.5;
  radius = 17;
  readonly target = new THREE.Vector3();
  readonly pendingPan = { x: 0, y: 0 };
  /** Where the ghost hand is while the screensaver plays, for the recorded path. */
  ghostNdc: Ndc | null = null;
  /** What the camera did this frame (the trail damping reads it). */
  azimuthNow = 0;
  radiusNow = 17;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  orbitBy(dx: number, dy: number): void {
    this.azimuth -= dx * 0.005;
    this.elevation = Math.max(-1.4, Math.min(1.4, this.elevation + dy * 0.005));
  }

  /** factor > 1 zooms in (a pinch opening). */
  zoomBy(factor: number): void {
    this.radius = Math.max(3, Math.min(40, this.radius / factor));
  }

  panBy(dx: number, dy: number): void {
    this.pendingPan.x += dx;
    this.pendingPan.y += dy;
  }

  /** Back to the subject (the screensaver always starts here). */
  recentre(): void {
    this.target.set(0, 0, 0);
    this.pendingPan.x = 0;
    this.pendingPan.y = 0;
  }

  /**
   * Place the camera for this frame. `idleSpeed` is the editor's orbit
   * (rad/s); in the screensaver the choreography owns the pose.
   */
  place(nowSeconds: number, dt: number, choreography: CameraChoreography, saverActive: boolean, idleSpeed: number): void {
    const camera = this.camera;
    this.azimuth += dt * (saverActive ? choreography.orbitSpeed * choreography.orbitDirection : idleSpeed);
    let radiusNow = this.radius;
    let elevationNow = this.elevation + breatheOffset(choreography, nowSeconds);
    let azimuthNow = this.azimuth;
    if (saverActive) {
      // In screensaver the camera follows the active preset's choreography:
      // the dolly breath, and (by path) the figure8 weave or the lean toward
      // the recorded hand. Defaults reproduce the authored motion exactly.
      const pose = cameraPose(choreography, nowSeconds, this.azimuth, this.elevation, this.ghostNdc);
      azimuthNow = pose.azimuth;
      elevationNow = pose.elevation;
      this.radius = pose.radius;
      radiusNow = pose.radius;
    }
    const t = this.target;
    camera.position.set(
      t.x + radiusNow * Math.cos(elevationNow) * Math.sin(azimuthNow),
      t.y + radiusNow * Math.sin(elevationNow),
      t.z + radiusNow * Math.cos(elevationNow) * Math.cos(azimuthNow)
    );
    camera.lookAt(t);
    // Two-finger pan moves the target in the camera's own plane, applied here
    // so the basis is the frame's fresh orientation.
    const pan = this.pendingPan;
    if (pan.x !== 0 || pan.y !== 0) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const worldPerPx = (2 * this.radius * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, window.innerHeight);
      t.addScaledVector(right, -pan.x * worldPerPx).addScaledVector(up, pan.y * worldPerPx);
      pan.x = 0;
      pan.y = 0;
    }
    this.azimuthNow = azimuthNow;
    this.radiusNow = radiusNow;
  }
}

export interface HandStage {
  readonly engine: SimEngine;
  readonly params: EngineParams;
  saverActive(): boolean;
}

/**
 * The hand: pointer force, gestures, ripples, and the hand VOID remembers.
 *
 * A screensaver cannot be nudged by a real mouse (any movement exits it), so
 * the pointer path is recorded while you work and replayed as a ghost in the
 * saver. On touch: one finger orbits, two pinch and pan, and a touch-and-hold
 * becomes the pointer force; the mouse keeps every behaviour it had.
 */
export class Hand {
  /** The live pointer settings the panel's HAND tool edits. */
  readonly pointer = { strength: 0, mode: 1, ghost: true };
  private readonly track = new PointerTrack();
  private readonly influence = new PointerInfluence();
  private readonly gestures = new GestureTracker();
  private readonly ray = new THREE.Raycaster();
  private readonly ndcVec = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly hit = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly origin = new THREE.Vector3(0, 0, 0);
  private ndc: Ndc | null = null;
  private ghostClock = 0;
  /** Where the last ripple was born: ripples answer movement, not rest. */
  private readonly lastRipple = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly rig: OrbitRig,
    private readonly stage: HandStage
  ) {
    this.track.begin(performance.now() / 1000);
    canvas.addEventListener("pointerdown", (e) => {
      this.gestures.pointerDown(e.pointerId, e.clientX, e.clientY, e.pointerType, performance.now());
    });
    window.addEventListener("pointermove", (e) => {
      this.gestures.pointerMove(e.pointerId, e.clientX, e.clientY, performance.now());
      // The mouse's hover is the touch: recorded for the screensaver's ghost,
      // and mapped into the scene for the pointer force.
      if (e.pointerType === "mouse") this.touchAt(e.clientX, e.clientY);
    });
    canvas.addEventListener("pointermove", (e) => this.touchAt(e.clientX, e.clientY));
    window.addEventListener("pointerup", (e) => this.gestures.pointerUp(e.pointerId));
    window.addEventListener("pointercancel", (e) => this.gestures.pointerUp(e.pointerId));
    canvas.addEventListener("wheel", (e) => {
      rig.radius = Math.max(3, Math.min(40, rig.radius * (1 + Math.sign(e.deltaY) * 0.1)));
    });
  }

  private toNdc(clientX: number, clientY: number): Ndc {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      y: -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    };
  }

  private touchAt(clientX: number, clientY: number): void {
    const ndc = this.toNdc(clientX, clientY);
    this.ndc = ndc;
    this.influence.touch();
    this.track.record(performance.now() / 1000, ndc.x, ndc.y);
  }

  private worldAt(ndc: Ndc): { x: number; y: number; z: number } {
    this.ndcVec.set(ndc.x, ndc.y);
    this.ray.setFromCamera(this.ndcVec, this.camera);
    this.camera.getWorldDirection(this.normal);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.origin);
    const hit = this.ray.ray.intersectPlane(this.plane, this.hit);
    if (!hit) return { x: 0, y: 0, z: 0 };
    return { x: hit.x, y: hit.y, z: hit.z };
  }

  /** Once per frame: consume gestures, then write the pointer force into the params. */
  update(dt: number): void {
    const { rig, stage, influence, pointer } = this;
    const params = stage.params;
    const saver = stage.saverActive();
    // Consume the gesture layer first: orbit, pinch zoom, two-finger pan,
    // and the touch-hold that becomes the pointer force.
    const g = this.gestures.take(performance.now());
    if (g.orbitDx !== 0 || g.orbitDy !== 0) rig.orbitBy(g.orbitDx, g.orbitDy);
    if (g.zoom !== 1) rig.zoomBy(g.zoom);
    if (g.panDx !== 0 || g.panDy !== 0) rig.panBy(g.panDx, g.panDy);
    influence.tick(dt);
    let ndc = this.ndc;
    if (g.hold && !saver) {
      // A finger held still is the touch: the swarm leans toward it, and the
      // hold joins the recorded hand the screensaver's ghost replays.
      ndc = this.toNdc(g.hold.x, g.hold.y);
      influence.touch();
      this.track.record(performance.now() / 1000, ndc.x, ndc.y);
    }
    if (saver) {
      // Real input would end the screensaver, so play back the recorded hand.
      if (!pointer.ghost) {
        params.pointer.strength = 0;
        return;
      }
      this.ghostClock += dt;
      ndc = this.track.at(this.ghostClock) ?? ghostLissajous(this.ghostClock);
      influence.touch();
      rig.ghostNdc = ndc; // the recorded path leans the camera toward the hand
    }
    // The hand rings the swarm even when the attractor rests: a look that
    // arms ripples gets wavefronts wherever the pointer travels. The field
    // throttles its own gap.
    if (params.pointer.ripple > 0 && ndc && influence.current > 0.4) {
      const rdx = ndc.x - this.lastRipple.x;
      const rdy = ndc.y - this.lastRipple.y;
      if (rdx * rdx + rdy * rdy > 0.0016) {
        this.lastRipple.x = ndc.x;
        this.lastRipple.y = ndc.y;
        const w = this.worldAt(ndc);
        stage.engine.spawnRipple(w.x, w.y, w.z);
      }
    }
    const strength = pointer.strength * influence.current;
    if (!ndc || strength <= 0.0001) {
      params.pointer.strength = 0;
      return;
    }
    const world = this.worldAt(ndc);
    params.pointer.x = world.x;
    params.pointer.y = world.y;
    params.pointer.z = world.z;
    params.pointer.mode = pointer.mode;
    params.pointer.strength = strength;
  }
}
