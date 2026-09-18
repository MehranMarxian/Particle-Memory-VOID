/**
 * Hint gating: a sticky hint (a runtime error) must not be shouted over by
 * routine traffic, but it must also expire. The old behaviour latched the
 * sticky flag until reload, so one error permanently muted the hint line.
 * Pure, so the expiry is testable without a DOM.
 */
export class HintGate {
  private stickyUntil = 0;

  /** May a hint of the given stickiness show at `now` (ms)? */
  allows(now: number, sticky: boolean): boolean {
    return sticky || now >= this.stickyUntil;
  }

  /** A sticky hint holds the gate for `seconds`. */
  hold(seconds: number, now: number): void {
    this.stickyUntil = now + Math.max(0, seconds) * 1000;
  }

  /** Open the gate immediately (used when the sticky text is dismissed). */
  release(): void {
    this.stickyUntil = 0;
  }
}
