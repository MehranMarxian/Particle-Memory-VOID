import { kmeansColors } from "@/sources/vision";
import { mulberry32 } from "@/utils/math";

/**
 * SPECIES FROM COLOUR (v0.11.2): the memory's own palette becomes its
 * ecosystem. The source colours are clustered into `speciesCount` groups
 * (k-means, dark to light), and each particle belongs to the species of
 * the colour it came from - the shadows of a face are one species, its
 * skin another, the light behind it a third.
 *
 * A fixed seed keeps the same photo giving the same species on every
 * rebuild, density change and backend switch.
 */
export function colourSpecies(
  colors: Float32Array,
  count: number,
  speciesCount: number,
  seed = 0x5eed
): Uint8Array {
  const { labels } = kmeansColors(colors, count, speciesCount, mulberry32(seed));
  // A near-monochrome source can leave clusters empty; that is fine - the
  // matrix still has the rows, they simply have no members.
  return labels;
}
