// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { EngineHost } from "@/app/engineHost";
import { defaultEngineParams } from "@/types";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";
import type { FlatSource } from "@/sources";

/**
 * The engine host, out of main.ts (0.12 slice 2): backend choice, building,
 * the carried switch, and every refusal said out loud. No GPU here: a
 * renderer that refuses WebGL2 is exactly what a GPU-less visitor brings.
 */
function noWebgl2Renderer(): THREE.WebGLRenderer {
  return {
    domElement: document.createElement("canvas"),
    capabilities: { isWebGL2: false },
    extensions: { get: () => null },
  } as unknown as THREE.WebGLRenderer;
}

function sample(count: number): FlatSource {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3).fill(0.8);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.cos(i) * 3;
    positions[i * 3 + 1] = Math.sin(i) * 3;
    positions[i * 3 + 2] = (i % 7) * 0.1;
  }
  return { count, positions, colors, normals: new Float32Array(count * 3), weights: new Float32Array(count) };
}

function makeHost() {
  const scene = new THREE.Scene();
  const hints: string[] = [];
  const installs: string[] = [];
  const host = new EngineHost({
    renderer: noWebgl2Renderer(),
    scene,
    stage: document.createElement("div"),
    params: defaultEngineParams(),
    speciesCount: () => 4,
    coarsePointer: false,
    hint: (t) => hints.push(t),
    onInstalled: (how) => installs.push(how),
  });
  return { host, scene, hints, installs };
}

describe("engine host", () => {
  it("builds a CPU engine and its Points view, and tells the app once", () => {
    const { host, scene, installs } = makeHost();
    host.mode = "cpu";
    expect(host.build(sample(300))).toBe(true);
    expect(host.engine).toBeInstanceOf(ParticleEngine);
    expect(host.backend).toBe("cpu");
    expect(host.view).toBeInstanceOf(ParticleRenderer);
    expect(scene.children).toContain((host.view as ParticleRenderer).points);
    expect(installs).toEqual(["build"]);
    // Targets are the source.
    expect(host.engine.targets[3]).toBeCloseTo(Math.cos(1) * 3, 5);
  });

  it("auto falls back to the CPU quietly when WebGL2 is refused", () => {
    const { host, hints } = makeHost();
    expect(host.build(sample(200))).toBe(true);
    expect(host.backend).toBe("cpu");
    expect(hints).toEqual([]);
  });

  it("a forced GPU that is refused builds nothing and says why", () => {
    const { host, hints, installs } = makeHost();
    host.mode = "gpu";
    expect(host.build(sample(200))).toBe(false);
    expect(installs).toEqual([]);
    expect(hints[0]).toMatch(/GPU UNAVAILABLE/);
  });

  it("a switch carries the live swarm and replaces the view in the scene", () => {
    const { host, scene, installs } = makeHost();
    host.mode = "cpu";
    host.build(sample(250));
    const old = host.engine;
    const oldPoints = (host.view as ParticleRenderer).points;
    old.positions[0] = 42;
    old.memoryPerParticle[5] = 0.25;
    old.simTime = 7.5;
    host.switchTo("cpu", null);
    expect(host.engine).not.toBe(old);
    expect(host.engine.positions[0]).toBe(42);
    expect(host.engine.memoryPerParticle[5]).toBe(0.25);
    expect(host.engine.simTime).toBe(7.5);
    expect(scene.children).not.toContain(oldPoints);
    expect(installs).toEqual(["build", "switch"]);
  });

  it("a switch keeps the source's pristine colours, not the baked look", () => {
    const { host } = makeHost();
    host.mode = "cpu";
    host.build(sample(100));
    const pristine = host.engine.colors.slice();
    host.engine.colors.fill(0.1); // a look baked over them
    host.switchTo("cpu", pristine);
    expect(host.engine.colors[0]).toBeCloseTo(0.8, 5);
  });

  it("asking for WebGPU before it loads keeps the running backend", () => {
    const { host, hints } = makeHost();
    host.mode = "cpu";
    host.build(sample(100));
    const before = host.engine;
    host.switchTo("webgpu", null);
    expect(host.engine).toBe(before);
    expect(host.mode).toBe("cpu");
    expect(hints.at(-1)).toMatch(/WEBGPU IS NOT LOADED/);
  });

  it("the density menu grows only once WebGPU is loaded", () => {
    const { host } = makeHost();
    host.mode = "webgpu";
    expect(host.webgpuReady).toBe(false);
    expect(host.densityMenu().at(-1)).toBe(50000);
    expect(host.backendForCount(12000)).toBe("gpu");
  });

  it("loading WebGPU where there is none rejects in plain words", async () => {
    const { host } = makeHost();
    vi.stubGlobal("navigator", { ...navigator, gpu: undefined });
    await expect(host.loadWebGpu()).rejects.toThrow(/no WebGPU/);
    expect(host.webgpuReady).toBe(false);
    vi.unstubAllGlobals();
  });
});
