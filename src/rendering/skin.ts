/**
 * The liquid skin's decisions (0.15), pure and testable. The pass itself is a
 * lazy chunk (rendering/LiquidSkin.ts); this part ships with the piece.
 *
 * The memory materializes: while it holds, the swarm condenses into a surface;
 * as it goes, the surface melts back into the particles that were holding it.
 */

/** Below this agitation the skin is whole. */
const WHOLE_BELOW = 0.15;
/** Above this agitation only the particles are left. */
const GONE_ABOVE = 0.55;

/**
 * How much skin to show. `agitation` is how far the memory has gone: 0.05 held,
 * 1 forgotten, in the cycle and by hand alike (medium.agitation).
 */
export function skinAmount(skin: number, agitation: number): number {
  if (!(skin > 0)) return 0;
  const t = Math.min(1, Math.max(0, (agitation - WHOLE_BELOW) / (GONE_ABOVE - WHOLE_BELOW)));
  return skin * (1 - t * t * (3 - 2 * t));
}

/**
 * World radius of a particle's sphere: wide enough for neighbours to touch.
 * A swarm spreads the same area over fewer particles, so a thinner swarm gets
 * larger spheres, within reason.
 */
export function skinRadius(count: number): number {
  return Math.min(0.45, 0.13 * Math.sqrt(12000 / Math.max(1000, count)));
}
