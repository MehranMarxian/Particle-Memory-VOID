/**
 * The WebGPU backend's one entry point, imported dynamically by the app
 * only when ?backend=webgpu asks for it: everything behind this file is a
 * lazy chunk and never touches the eager budget.
 */
export { acquireWebGpu, WebGpuParticleEngine, type WebGpuContext } from "./WebGpuParticleEngine";
export { WebGpuSwarmView } from "@/rendering/webgpu/WebGpuSwarmView";
