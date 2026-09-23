import type { VisualSettings } from "@/rendering/VisualSettings";
import { isFieldAxis } from "@/rendering/VisualSettings";
import type { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { paletteStops, writeRandomColors, writeSpeciesColors } from "@/rendering/palette";
import { fieldTintScale, writeFieldTintColors } from "@/rendering/fieldTint";
import { writeSpeciesShapes, writeUniformShape } from "@/rendering/shapes";
import { clampPhenotype, type Phenotype } from "@/presets/phenotype";
import type { SimEngine } from "./host";

export interface LookHost {
  readonly engine: SimEngine;
  readonly renderer: ParticleRenderer | null;
  readonly visual: VisualSettings;
  readonly speciesCount: number;
  /** Called on every fresh colour bake, before upload (Witness darkens its lost). */
  decorateColors?(colors: Float32Array, count: number): void;
}

/**
 * The look, baked into per-particle buffers.
 *
 * Colours and shapes are baked values, exactly like the source's own
 * colours: written when the look, the engine or the species change, never
 * per frame, so nothing here costs anything at render time. The one
 * exception is a ramp that follows a live field (scent/heat), which the
 * frame loop re-bakes - colours only - at a low rate.
 */
export class LookBaker {
  /**
   * The source's own baked colours, kept aside so switching back from
   * SPECIES/RANDOM to MONOCHROME/SOURCE restores them exactly.
   */
  sourceColors: Float32Array | null = null;
  /** Appearance genes of the current champion, once the search has found one. */
  phenotype: Phenotype | null = null;
  private seed = 1;
  private lastMode = "";

  constructor(private readonly host: LookHost) {}

  /** Keep the champion's look legal for a new species count. */
  clampPhenotype(speciesCount: number): void {
    this.phenotype = this.phenotype ? clampPhenotype(this.phenotype, speciesCount) : null;
  }

  /**
   * Bake the per-particle colours for the current look settings.
   *
   * Split from the shape bake so the field-tint refresh (a low-rate tick) can
   * re-bake colours alone: the shapes did not change since the last look
   * change, and a full-buffer rewrite per tick is ms the weak machines do not
   * have.
   */
  applyColors(): void {
    const { engine, renderer, visual, speciesCount } = this.host;
    if (!renderer) return;
    const mode = visual.colorMode;
    if (mode === "species") {
      writeSpeciesColors(engine.colors, engine.count, speciesCount, undefined, this.phenotype?.hue);
    } else if (mode === "random") {
      if (this.lastMode !== "random") this.seed = (Math.random() * 1e9) | 0;
      writeRandomColors(engine.colors, engine.count, this.seed);
    } else if (mode === "gradient" && isFieldAxis(visual.gradientAxis)) {
      // Field tints are baked from the CPU-side fields, so both backends look the
      // same and no new texture has to reach the shader.
      const field = visual.gradientAxis === "heat" ? engine.heat : engine.scent;
      writeFieldTintColors(
        engine.colors,
        engine.positions,
        engine.count,
        field,
        paletteStops(visual.gradientPalette),
        fieldTintScale(field.peak())
      );
    } else if (this.sourceColors) {
      // Count-scoped, deliberately: the GPU engine's colour buffer is
      // texture-padded (texW*texH >= count) while the CPU engine's is exactly
      // count, so a full-buffer set threw RangeError on the first look bake
      // after every backend switch - and left the new renderer's points out
      // of the scene, a black canvas.
      const src = this.sourceColors;
      engine.colors.set(src.subarray(0, Math.min(src.length, engine.count * 3)));
    }
    this.lastMode = mode;
    this.host.decorateColors?.(engine.colors, engine.count);
    renderer.markColorsDirty();
  }

  /** Bake the per-particle sprite shapes (uniform, or one per species). */
  applyShapes(): void {
    const { engine, renderer, visual, speciesCount } = this.host;
    if (!renderer) return;
    if (visual.shapeBySpecies) {
      writeSpeciesShapes(renderer.shapeBuffer, engine.count, speciesCount, undefined, this.phenotype?.shape);
    } else {
      writeUniformShape(renderer.shapeBuffer, engine.count, visual.shape);
    }
    renderer.markShapesDirty();
  }

  /** Re-bake colour and shape. */
  apply(): void {
    this.applyColors();
    this.applyShapes();
  }
}
