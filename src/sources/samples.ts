/**
 * The three bundled sample sources, offered by the YOUR MEMORY card so a
 * first-time visitor can see the piece working before they have a file of
 * their own. Tests assert these files really ship in public/samples.
 */
export interface SampleSource {
  label: string;
  file: string;
}

export const SAMPLES: readonly SampleSource[] = [
  { label: "FIGURE", file: "void-figure.png" },
  { label: "CLOUD", file: "void-cloud.ply" },
  { label: "SPHERE", file: "void-sphere.obj" },
];

export function sampleUrl(file: string): string {
  return "/samples/" + file;
}
