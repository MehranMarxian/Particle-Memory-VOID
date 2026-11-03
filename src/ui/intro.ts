/**
 * The intro plan: when VOID boots it may greet a first-time visitor with the
 * controls guide. The decision is pure so it can be tested, and it stays out
 * of the way of installed (screensaver) boots: those users did not ask for UI.
 *
 * The screensaver can also start *after* boot (`?saver=1`), so the caller
 * checks `saver.active` again right before acting on the plan.
 *
 * A first visit by touch gets one line instead of the guide: on a phone the
 * guide would cover the piece in its first seconds, and the guide is one tap
 * away under MORE.
 */
export type IntroPlan = "guide" | "hint" | "nudge" | "none";

export interface IntroSignals {
  /** Has the guide already introduced itself on this device? */
  seenIntro: boolean;
  /** Booting as the installed Windows screensaver? */
  installed: boolean;
  /** Is touch this device's main way in? */
  touch: boolean;
}

export function planIntro(signals: IntroSignals): IntroPlan {
  if (signals.installed) return "none";
  if (signals.seenIntro) return "nudge";
  return signals.touch ? "hint" : "guide";
}
