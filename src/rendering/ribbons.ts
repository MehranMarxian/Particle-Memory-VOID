import type * as THREE from "three";

/**
 * Ribbons (0.12 slice 4): trails as geometry. Where the afterimage smears
 * the whole frame, a ribbon is the particle's own path - a thin strip
 * through its last few positions, fading toward the oldest.
 *
 * The engines keep the history (a ring of RIBBON_SLOTS position snapshots,
 * one every RIBBON_EVERY steps (~0.6 s in all), only while ribbons are on); the renderers
 * draw it, each particle one instance of (RIBBON_SLOTS - 1) segments
 * extruded to a constant pixel width on screen. GPU backends only: the CPU
 * engine is the small-count fallback and draws none.
 */
export const RIBBON_SLOTS = 12;
export const RIBBON_EVERY = 3;
/** A segment longer than this (world units) is a jump - a respawn - and is not drawn. */
export const RIBBON_JUMP = 2.5;
/** Ribbon width in CSS pixels. */
export const RIBBON_WIDTH = 1.4;

/** What a renderer needs to draw the history. */
export interface RibbonHistory {
  readonly texture: THREE.Texture;
  /** The slot written last. */
  readonly head: number;
  /** Slots holding real history (fills up after ribbons turn on). */
  readonly fill: number;
}

/** One instance's strip: (slot, side) per vertex, two triangles per segment. */
export function ribbonStrip(slots = RIBBON_SLOTS): Float32Array {
  const out: number[] = [];
  for (let s = 0; s < slots - 1; s++) {
    const a = [s, -1, s, 1, s + 1, -1];
    const b = [s + 1, -1, s, 1, s + 1, 1];
    out.push(...a, ...b);
  }
  return new Float32Array(out);
}
