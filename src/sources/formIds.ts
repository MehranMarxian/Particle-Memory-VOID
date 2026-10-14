/**
 * The forms' names (0.13), small and eager so the panel can offer them; the
 * forms themselves (sources/forms.ts) load on the first one chosen. A test
 * holds the two lists together.
 */
export const FORM_IDS = ["sphere", "cube", "helix", "knot", "tesseract", "galaxy", "attractor", "mobius"] as const;
export type FormId = (typeof FORM_IDS)[number];
