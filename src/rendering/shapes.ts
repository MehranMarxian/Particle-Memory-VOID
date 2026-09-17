import { PARTICLE_SHAPES, type ParticleShape } from "./VisualSettings";

/**
 * Sprite shapes, resolved analytically in the fragment shader.
 *
 * Each shape is expressed as a *field* rather than a signed distance: a value
 * that is 0 at the sprite centre and exactly 1 at the shape's outer edge, in
 * every direction. That single normalisation is what lets one pair of
 * thresholds draw all of them, and it is why the circle entry reproduces the
 * original `length(gl_PointCoord - 0.5)` sprite exactly — turning shapes on
 * cannot change the look of the piece until a non-circle shape is chosen.
 *
 * No texture, no atlas, no geometry change: a handful of branches on a value
 * that is a compile-time constant per particle.
 */
const SHAPE_FIELDS: readonly string[] = [
  // circle: the original sprite. field = length(uv) * 2
  "return r * 2.0;",
  // box: square of the same half-extent as the disc.
  "return max(abs(uv.x), abs(uv.y)) * 2.0;",
  // triangle: equilateral, vertex up, inscribed in the same radius.
  "float k = mod(th + 0.5235988, 2.0943951) - 1.0471976;\n      return r * cos(k) * 4.0;",
  // ring: hollow centre, thick stroke.
  "return abs(r - 0.30) * 4.0;",
  // star: five points, radius modulated by angle.
  "return r * 2.0 / (0.62 + 0.33 * cos(5.0 * th));",
];

/** The fragment-shader function that turns a shape id into a 0..1 field. */
export const SHAPE_FIELD_GLSL = `float shapeField(float id, vec2 uv) {
  float r = length(uv);
  float th = atan(uv.y, uv.x);
${SHAPE_FIELDS.map((body, i) => `  ${i === SHAPE_FIELDS.length - 1 ? "// last" : `if (id < ${i + 0.5}) {`}\n      ${body}${i === SHAPE_FIELDS.length - 1 ? "" : "\n  }"}`).join("\n")}
}`;

/** Index of a shape in the canonical order; unknown names fall back to circle. */
export function shapeIndex(shape: ParticleShape): number {
  const i = PARTICLE_SHAPES.indexOf(shape);
  return i < 0 ? 0 : i;
}

/** Name of a shape by index, wrapping like the species assignment does. */
export function shapeName(index: number): ParticleShape {
  const n = PARTICLE_SHAPES.length;
  return PARTICLE_SHAPES[(((index | 0) % n) + n) % n];
}

/** Cycle the base shape, the same order the panel lists them in. */
export function nextShape(shape: ParticleShape): ParticleShape {
  return PARTICLE_SHAPES[(shapeIndex(shape) + 1) % PARTICLE_SHAPES.length];
}

/**
 * One shape per species, so eight species locked in an attract/repel dance
 * read as eight populations instead of eight identical clouds.
 */
export function writeSpeciesShapes(
  shapes: Float32Array,
  count: number,
  speciesCount: number,
  speciesOf: (i: number) => number = (i) => i % Math.max(1, speciesCount),
  /** Optional evolved shape index per species, overriding the default order. */
  shapeOverride?: number[]
): void {
  const n = PARTICLE_SHAPES.length;
  for (let i = 0; i < count; i++) {
    const species = Math.abs(speciesOf(i));
    const chosen = shapeOverride?.[species];
    shapes[i] = chosen === undefined ? species % n : ((Math.floor(chosen) % n) + n) % n;
  }
}

/** Fill the whole buffer with one shape (shapeBySpecies off). */
export function writeUniformShape(shapes: Float32Array, count: number, shape: ParticleShape): void {
  shapes.fill(shapeIndex(shape), 0, count);
}
