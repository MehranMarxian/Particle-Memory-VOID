/**
 * The bundled sample sources, offered by the YOUR MEMORY card so a
 * first-time visitor can see the piece working before they have a file of
 * their own. Tests assert these files really ship in public/samples.
 */
export interface SampleSource {
  label: string;
  file: string;
  /** A painted depth map beside it (white near, black far), when it has one. */
  depth?: string;
}

/** A photograph by Mehran Ahmadi: what a first visit on a phone remembers. */
export const PORTRAIT_SAMPLE = "void-portrait.webp";

export const SAMPLES: readonly SampleSource[] = [
  { label: "PORTRAIT", file: PORTRAIT_SAMPLE, depth: "void-portrait.depth.png" },
  { label: "FIGURE", file: "void-figure.png" },
  { label: "CLOUD", file: "void-cloud.ply" },
  { label: "SPHERE", file: "void-sphere.obj" },
  // A body that moves: a 4D clip of a walking figure (scripts/bake).
  { label: "WALKER", file: "void-walker.clip.ply" },
];

export function sampleUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`;
}

/** The depth map that belongs to a bundled sample's URL, or null for anything else. */
export function depthMapUrlFor(url: string): string | null {
  const file = url.split(/[?#]/)[0].split("/").pop() ?? "";
  if (!url.split(/[?#]/)[0].includes("/samples/")) return null;
  const sample = SAMPLES.find((s) => s.file === file && s.depth);
  return sample?.depth ? sampleUrl(sample.depth) : null;
}
