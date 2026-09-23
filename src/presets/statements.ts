/**
 * THE STATEMENTS - the one place the piece speaks in words.
 *
 * Each look has one line. It appears quietly when the look is chosen, and
 * stays for the whole of a look's time in the exhibition. Edit freely:
 * the key is the look's name (see src/presets/presets.ts), the value is
 * the line. Keep them short enough to read in one breath. A look missing
 * from this list simply says nothing.
 *
 * First draft: Claude, for Mehran Ahmadi, 2026-09-24.
 */
export const LOOK_STATEMENTS: Readonly<Record<string, string>> = {
  moon: "What the hand disturbs, the memory forgives. It always comes home.",
  portrait: "A face, held still by thousands of small things that do not know it is a face.",
  organic: "Remembering is not storage. It is a body, breathing around what it keeps.",
  scan: "Looked at closely enough, anything becomes evidence.",
  architecture: "Some memories bear weight. Take one away and the others lean.",
  void: "What remains when nothing is being remembered: life, without a subject.",
  chaos: "Forgetting is not silence. It is a storm with a rumour of a face in it.",
  predator: "Every system that remembers also eats.",
  galaxy: "A memory old enough begins to have gravity.",
  fireworks: "It celebrates, and in celebrating, spends itself.",
  hearth: "What we leave behind is warmth, and warmth is the whole picture.",
  traces: "We are made less of where we are than of where we have been.",
  exhale: "Every breath out is a small letting go. Every breath in, a return.",
  witness:
    "One light goes out every four seconds. That is the estimated rate at which people die of hunger and its causes. Nothing here is faster than the truth.",
  murmuration: "Thousands of bodies, one decision, made again every moment.",
  aurora: "Light that never lands. A memory kept in the sky.",
  // Not looks, but moments the piece names.
  genesis: "The first particle system was a wall of fire that left a living world behind it.",
  presence: "For as long as you stay, you are what it remembers.",
};

export function statementFor(name: string): string | null {
  return LOOK_STATEMENTS[name] ?? null;
}
