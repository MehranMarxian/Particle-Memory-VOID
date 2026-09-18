/**
 * Carry live per-particle state from one engine to another — the backend
 * switch (G). The swarm must survive the trip as the same organism: same
 * positions, same velocities, same memory, same clocks. Without this the
 * new engine boots from silence and the memory visibly screeches to a
 * halt on every switch.
 *
 * Works on the structural surface both engines share (the app's SimEngine
 * shape), so the CPU and GPU paths go through exactly the same code.
 */
export interface LiveStateView {
  count: number;
  simTime: number;
  positions: Float32Array;
  velocities: Float32Array;
  memoryPerParticle: Float32Array;
  renderState: Float32Array;
}

export function carryLiveState(from: LiveStateView, to: LiveStateView): void {
  const n = Math.min(from.count, to.count);
  to.simTime = from.simTime;
  for (let i = 0; i < n * 3; i++) {
    to.positions[i] = from.positions[i];
    to.velocities[i] = from.velocities[i];
  }
  for (let i = 0; i < n; i++) {
    to.memoryPerParticle[i] = from.memoryPerParticle[i];
  }
  // Organism state: phase, omega, stress, asleep. The GPU engine blits this
  // into its state texture via uploadInitialState; the CPU engine reads it
  // directly.
  for (let i = 0; i < n * 4; i++) {
    to.renderState[i] = from.renderState[i];
  }
}
