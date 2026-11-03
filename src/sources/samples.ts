/**
 * The bundled sample sources, offered by the YOUR MEMORY card so a
 * first-time visitor can see the piece working before they have a file of
 * their own. Tests assert these files really ship in public/samples.
 */
export interface SampleSource {
  label: string;
  file: string;
}

/** A photograph by Mehran Ahmadi: what a first visit on a phone remembers. */
export const PORTRAIT_SAMPLE = "void-portrait.webp";

export const SAMPLES: readonly SampleSource[] = [
  { label: "PORTRAIT", file: PORTRAIT_SAMPLE },
  { label: "FIGURE", file: "void-figure.png" },
  { label: "CLOUD", file: "void-cloud.ply" },
  { label: "SPHERE", file: "void-sphere.obj" },
  // A body that moves: a 4D clip of a walking figure (scripts/bake).
  { label: "WALKER", file: "void-walker.clip.ply" },
];

export function sampleUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`;
}
