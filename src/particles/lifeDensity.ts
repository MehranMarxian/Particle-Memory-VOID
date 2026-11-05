/**
 * Density-true life (0.15.2), shared by all three engines.
 *
 * A particle feels the sum of every neighbour in reach, and in the same
 * volume the number of neighbours grows with the count. So without this a
 * look tuned at 12,000 particles felt four times its forces at 50,000, and
 * the swarm collapsed into tight beads in rows. Above the density the looks
 * are authored at, each neighbour's force shrinks in proportion, and the total
 * a particle feels stays what its look was tuned to: the mean-field
 * correction. Below it nothing changes, so no look gets stronger than authored.
 */

/** The density the looks are authored at. */
export const AUTHORED_COUNT = 12000;

/** What every life force is multiplied by at this particle count. */
export function lifeDensityScale(count: number): number {
  return count <= AUTHORED_COUNT ? 1 : AUTHORED_COUNT / count;
}

/** How fast flocking turns a particle toward its neighbours' heading, per unit of alignment (1/s). */
export const ALIGN_RATE = 4;
/**
 * A flock is self-propelled (Vicsek): each bird keeps flying while it turns.
 * It steers toward the group's heading at this fraction of its top speed;
 * without it, matching velocities only brings everyone to rest together.
 */
export const CRUISE_FRACTION = 0.5;
