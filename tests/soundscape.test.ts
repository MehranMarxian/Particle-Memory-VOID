import { describe, expect, it } from "vitest";
import { soundscapeLevels } from "@/audio/soundscape";

describe("soundscape mapping", () => {
  it("hums even when the swarm is calm, and rises with stress", () => {
    const calm = soundscapeLevels({ stress: 0, reconstruction: 0, density: 0 });
    const tense = soundscapeLevels({ stress: 1, reconstruction: 0, density: 0 });
    expect(calm.hum).toBeGreaterThan(0);
    expect(tense.hum).toBeGreaterThan(calm.hum);
    expect(tense.hum).toBeLessThanOrEqual(1);
  });

  it("whispers only while the memory re-forms", () => {
    const drifting = soundscapeLevels({ stress: 0.2, reconstruction: 0, density: 12000 });
    const remembering = soundscapeLevels({ stress: 0.2, reconstruction: 1, density: 12000 });
    expect(drifting.whisper).toBe(0);
    expect(remembering.whisper).toBeGreaterThan(0.5);
  });

  it("shimmers with density and stays bounded", () => {
    const sparse = soundscapeLevels({ stress: 2, reconstruction: 2, density: 1000 });
    const dense = soundscapeLevels({ stress: 0, reconstruction: 0, density: 60000 });
    expect(dense.shimmer).toBeGreaterThan(sparse.shimmer);
    for (const level of [sparse, dense]) {
      for (const value of [level.hum, level.whisper, level.shimmer]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
