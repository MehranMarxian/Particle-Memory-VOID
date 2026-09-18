/**
 * The touch layer's gesture decisions, pure and testable.
 *
 * One finger orbits. Two fingers pinch to zoom and drag to pan. A
 * touch-and-hold — a finger that stays put past the delay — becomes the
 * pointer force, because touch has no hover: the swarm's touch must be
 * explicit. The mouse keeps every behaviour it had: drag to orbit, wheel to
 * zoom, move to touch.
 *
 * The tracker accumulates deltas between takes(); the frame loop consumes
 * them once per frame. No timers — a hold is evaluated from the clock the
 * caller passes, so the whole thing stays deterministic under test.
 */

export const HOLD_DELAY_MS = 300;
export const HOLD_SLOP_PX = 10;

export interface HoldPoint {
  x: number;
  y: number;
}

export interface GestureFrame {
  /** Accumulated orbit deltas since the last take, in screen px. */
  orbitDx: number;
  orbitDy: number;
  /** Multiplicative zoom since the last take (>1 = fingers spread = zoom in). */
  zoom: number;
  /** Two-finger pan since the last take, in screen px. */
  panDx: number;
  panDy: number;
  /** The hold point in client px while a touch-hold is active, else null. */
  hold: HoldPoint | null;
}

interface TrackedPointer {
  type: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  downAt: number;
}

const EMPTY: GestureFrame = { orbitDx: 0, orbitDy: 0, zoom: 1, panDx: 0, panDy: 0, hold: null };

export class GestureTracker {
  private pointers = new Map<number, TrackedPointer>();
  private orbitDx = 0;
  private orbitDy = 0;
  private zoom = 1;
  private panDx = 0;
  private panDy = 0;
  private pinchDist = 0;
  private holdId: number | null = null;
  private prevMidX = 0;
  private prevMidY = 0;

  /** Is this pointer a touch-hold candidate: single, touch, within the slop? */
  private holdCandidate(id: number, now: number): TrackedPointer | null {
    if (this.pointers.size !== 1) return null;
    const p = this.pointers.get(id);
    if (!p || p.type === "mouse") return null;
    const dx = p.x - p.startX;
    const dy = p.y - p.startY;
    if (dx * dx + dy * dy > HOLD_SLOP_PX * HOLD_SLOP_PX) return null;
    if (now - p.downAt < HOLD_DELAY_MS) return null;
    return p;
  }

  pointerDown(id: number, x: number, y: number, type: string, now: number): void {
    this.pointers.set(id, { type, x, y, startX: x, startY: y, lastX: x, lastY: y, downAt: now });
    // A second finger ends any hold and starts the pinch.
    if (this.pointers.size === 2) {
      this.holdId = null;
      this.pinchDist = this.currentPinchDist();
      const [mx, my] = this.currentMidpoint();
      this.prevMidX = mx;
      this.prevMidY = my;
    }
  }

  pointerMove(id: number, x: number, y: number, now: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    const prevX = p.x;
    const prevY = p.y;
    p.x = x;
    p.y = y;

    if (this.pointers.size >= 2) {
      // Two fingers: pinch to zoom, shared midpoint drag to pan. No orbit,
      // no hold — the midpoint's delta is the pan, whatever each finger did.
      const dist = this.currentPinchDist();
      if (this.pinchDist > 0 && dist > 0) this.zoom *= dist / this.pinchDist;
      this.pinchDist = dist;
      const [mx, my] = this.currentMidpoint();
      this.panDx += mx - this.prevMidX;
      this.panDy += my - this.prevMidY;
      this.prevMidX = mx;
      this.prevMidY = my;
      return;
    }

    // Single pointer. A hold candidate holds still: its sub-slop drift must
    // not orbit the camera. Past the slop it is a drag, and orbiting starts.
    const holding = this.holdCandidate(id, now);
    if (!holding || (this.holdId !== null && this.holdId !== id)) {
      this.orbitDx += x - prevX;
      this.orbitDy += y - prevY;
    }
    if (holding && this.holdId === null) this.holdId = id;
    if (!holding && this.holdId === id) this.holdId = null;

    p.lastX = x;
    p.lastY = y;
  }

  pointerUp(id: number): void {
    const had = this.pointers.delete(id);
    if (this.holdId === id || !had) this.holdId = null;
    if (this.pointers.size === 1) {
      // The surviving pointer becomes a fresh orbit drag from here.
      const [only] = this.pointers.values();
      only.startX = only.x;
      only.startY = only.y;
      this.pinchDist = 0;
      this.prevMidX = 0;
      this.prevMidY = 0;
    } else if (this.pointers.size >= 2) {
      this.pinchDist = this.currentPinchDist();
      const [mx, my] = this.currentMidpoint();
      this.prevMidX = mx;
      this.prevMidY = my;
    }
  }

  /** Consume the accumulated deltas and report the current hold, if any. */
  take(now: number): GestureFrame {
    let hold: HoldPoint | null = null;
    if (this.holdId !== null) {
      const p = this.pointers.get(this.holdId);
      if (p && this.holdCandidate(this.holdId, now)) hold = { x: p.x, y: p.y };
      else this.holdId = null;
    }
    const frame: GestureFrame = {
      orbitDx: this.orbitDx,
      orbitDy: this.orbitDy,
      zoom: this.zoom,
      panDx: this.panDx,
      panDy: this.panDy,
      hold,
    };
    this.orbitDx = 0;
    this.orbitDy = 0;
    this.zoom = 1;
    this.panDx = 0;
    this.panDy = 0;
    return frame;
  }

  private currentPinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private currentMidpoint(): [number, number] {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return [0, 0];
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }
}

export { EMPTY as EMPTY_GESTURE };
