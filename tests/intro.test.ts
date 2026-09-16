import { describe, expect, it } from "vitest";
import { hasSeenIntro, markIntroSeen, type Storage } from "@/presets/storage";
import { planIntro } from "@/ui/intro";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("first-visit intro flag", () => {
  it("starts unseen and stays seen once marked", () => {
    const storage = memoryStorage();
    expect(hasSeenIntro(storage)).toBe(false);
    markIntroSeen(storage);
    expect(hasSeenIntro(storage)).toBe(true);
    expect(hasSeenIntro(storage)).toBe(true);
  });

  it("degrades quietly when storage throws", () => {
    const broken: Storage = {
      getItem: () => {
        throw new Error("no storage");
      },
      setItem: () => {
        throw new Error("no storage");
      },
      removeItem: () => {
        throw new Error("no storage");
      },
    };
    expect(hasSeenIntro(broken)).toBe(false);
    expect(() => markIntroSeen(broken)).not.toThrow();
  });
});

describe("intro plan", () => {
  it("greets a first-time visitor with the guide", () => {
    expect(planIntro({ seenIntro: false, installed: false })).toBe("guide");
  });

  it("nudges a returning visitor instead", () => {
    expect(planIntro({ seenIntro: true, installed: false })).toBe("nudge");
  });

  it("stays out of the way of the installed screensaver", () => {
    expect(planIntro({ seenIntro: false, installed: true })).toBe("none");
    expect(planIntro({ seenIntro: true, installed: true })).toBe("none");
  });
});
