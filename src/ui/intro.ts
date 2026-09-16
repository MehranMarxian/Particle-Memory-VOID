/**
 * The intro plan: when VOID boots it may greet a first-time visitor with the
 * controls guide. The decision is pure so it can be tested, and it stays out
 * of the way of installed (screensaver) boots: those users did not ask for UI.
 *
 * The screensaver can also start *after* boot (`?saver=1`), so the caller
 * checks `saver.active` again right before acting on the plan.
 */
export type IntroPlan = "guide" | "nudge" | "none";

export interface IntroSignals {
  /** Has the guide already introduced itself on this device? */
  seenIntro: boolean;
  /** Booting as the installed Windows screensaver? */
  installed: boolean;
}

export function planIntro(signals: IntroSignals): IntroPlan {
  if (signals.installed) return "none";
  return signals.seenIntro ? "nudge" : "guide";
}
