import { describe, expect, it } from "vitest";
import { HOLD_SHARE, MAX_STEPS, Programme } from "@/morph/programme";

const form = (id: string) => ({ kind: "form" as const, id, label: id.toUpperCase() });

describe("the programme (0.13)", () => {
  it("plays each memory in turn: begin, release late in the step, then the next, looping", () => {
    const p = new Programme();
    p.seconds = 10;
    p.add(form("sphere"));
    p.add(form("galaxy"));
    expect(p.start()).toMatchObject({ type: "begin", index: 0 });
    expect(p.tick(10 * HOLD_SHARE - 0.1)).toBeNull();
    expect(p.tick(0.2)).toEqual({ type: "release" });
    expect(p.tick(1)).toBeNull();
    expect(p.tick(2)).toMatchObject({ type: "begin", index: 1, step: { id: "galaxy" } });
    p.tick(5);
    expect(p.tick(5)).toMatchObject({ type: "begin", index: 0 });
  });

  it("an empty programme does not play; removing the last step stops it", () => {
    const p = new Programme();
    expect(p.start()).toBeNull();
    p.add(form("cube"));
    p.start();
    p.remove(0);
    expect(p.playing).toBe(false);
  });

  it("holds at most MAX_STEPS", () => {
    const p = new Programme();
    for (let i = 0; i < MAX_STEPS + 3; i++) p.add(form("cube"));
    expect(p.steps.length).toBe(MAX_STEPS);
  });

  it("keeps forms across visits, not the visit's own memories, and only forms it knows", () => {
    const p = new Programme();
    p.seconds = 45;
    p.add(form("knot"));
    p.add({ kind: "memory", id: "m1", label: "portrait.jpg" });
    const q = new Programme();
    q.load(p.serialize(), ["knot"]);
    expect(q.steps).toEqual([form("knot")]);
    expect(q.seconds).toBe(45);
    const r = new Programme();
    r.load(JSON.stringify({ seconds: 9999, steps: [form("evil"), { kind: "form", id: "knot", label: 3 }] }), ["knot"]);
    expect(r.steps).toEqual([]);
    expect(r.seconds).toBe(180);
    r.load("{broken", ["knot"]);
    expect(r.steps).toEqual([]);
  });
});
