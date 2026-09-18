/**
 * Backend and density policy: what each simulation backend can sustain, and
 * how auto mode chooses. Pure, so the numbers are testable and live in one
 * place instead of inside the frame loop.
 *
 * The ceilings are provisional — measured on the dev machine (method and
 * numbers in docs/PLAN-0.9.0.md, part 2); the laptop-iGPU and phone columns
 * of that table are still to be filled in, and the touch numbers here are
 * the first guess, not a finding.
 */
export type Backend = "gpu" | "cpu";
export type BackendMode = "auto" | Backend;

/** The density menu, shared by the [ ] keys and the panel slider. */
export const DENSITY_LEVELS: readonly number[] = [4000, 8000, 12000, 20000, 32000, 50000];

/** Desktop default: 12k. Touch default: 4k. */
export const DEFAULT_DENSITY_INDEX = 2;
export const TOUCH_DENSITY_INDEX = 0;

/**
 * What each backend sustains in real time.
 *
 * GPU: the top of the menu. CPU: the force pass is O(n · neighbours) and 12k
 * already costs ~50 ms a step on a fast desktop, so the menu caps at the
 * level the audit's CPU budget covers with a step of headroom — which is
 * also the cap the ecology's second neighbour pass implies.
 */
export const DENSITY_CEILING: Record<Backend, number> = { gpu: 50000, cpu: 8000 };

/**
 * On a touch-primary device, auto picks the CPU engine at or below this
 * density: the GPU path pays three synchronous readbacks a frame, which
 * dominates at low density. Provisional pending device numbers — if a phone
 * measures faster on the GPU engine, this is the constant to raise.
 */
export const TOUCH_CPU_DENSITY = 4000;

/** Which backend auto mode wants for this density and pointer class. */
export function wantsCpuBackend(mode: BackendMode, count: number, coarsePointer: boolean): boolean {
  if (mode === "cpu") return true;
  if (mode === "gpu") return false;
  return coarsePointer && count <= TOUCH_CPU_DENSITY;
}

/** Clamp a requested density to the ceiling of the backend that will run it. */
export function effectiveDensity(count: number, backend: Backend): number {
  return Math.min(count, DENSITY_CEILING[backend]);
}
