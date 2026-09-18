import { parsePly, normalizePly, plyToSource } from "./plyParser";
import { sampleImage, type ImageDataLike } from "./imageSampler";
import { collectMeshes, sampleMesh } from "./meshSampler";
import { TARGET_WORLD_SIZE, type FlatSource, type SourceHandle, type SourceKind } from "./types";

/** Which extensions belong to which source kind. Adding a format later = one entry here. */
export const FORMAT_REGISTRY: Record<SourceKind, string[]> = {
  image: ["png", "jpg", "jpeg", "webp", "bmp", "gif"],
  mesh: ["glb", "gltf", "obj", "stl"],
  pointcloud: ["ply"],
  synthetic: [],
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function detectSourceKind(name: string): SourceKind | null {
  const ext = extensionOf(name);
  for (const [kind, exts] of Object.entries(FORMAT_REGISTRY)) {
    if (exts.includes(ext)) return kind as SourceKind;
  }
  return null;
}

/** Downscaled RGBA pixel data for image sampling (keeps CDF memory bounded). */
async function imageToData(blob: Blob, maxDim = 768): Promise<ImageDataLike> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as OffscreenCanvas).getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("no 2d context for image sampling");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: data.data };
}

export const IMAGE_SAMPLE_DEFAULTS = {
  luminanceWeight: 0.8,
  contrast: 1.1,
  edgeWeight: 0.3,
  depth: 0.35,
};

/**
 * Load any supported file into a resamplable source handle.
 * Heavy loader modules (GLTF/OBJ/STL) are imported lazily.
 */
export async function loadSource(
  name: string,
  data: Blob,
  kind?: SourceKind
): Promise<SourceHandle> {
  const detected = kind ?? detectSourceKind(name);
  if (!detected) {
    throw new Error(
      `unsupported source format: .${extensionOf(name)} (supported: ${[
        ...FORMAT_REGISTRY.image,
        ...FORMAT_REGISTRY.mesh,
        ...FORMAT_REGISTRY.pointcloud,
      ].join(", ")})`
    );
  }

  if (detected === "image") {
    const img = await imageToData(data);
    return {
      name,
      kind: detected,
      detail: `${img.width}×${img.height} image`,
      resample: (count) =>
        sampleImage(img, { count, planeSize: TARGET_WORLD_SIZE, ...IMAGE_SAMPLE_DEFAULTS }),
    };
  }

  if (detected === "pointcloud") {
    const buffer = await data.arrayBuffer();
    const ply = parsePly(buffer);
    normalizePly(ply, TARGET_WORLD_SIZE);
    return {
      name,
      kind: detected,
      detail: `${ply.count.toLocaleString()} points`,
      resample: (count) => plyToSource(ply, count),
    };
  }

  // Mesh formats.
  const buffer = await data.arrayBuffer();
  let root: import("three").Object3D;
  const ext = extensionOf(name);
  if (ext === "glb" || ext === "gltf") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const isJson = ext === "gltf";
    root = await new Promise<{ scene: import("three").Object3D }>((resolve, reject) =>
      loader.parse(
        isJson ? new TextDecoder().decode(buffer) : buffer,
        "",
        (gltf) => resolve(gltf),
        reject
      )
    ).then((gltf) => gltf.scene);
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    root = new OBJLoader().parse(new TextDecoder().decode(buffer));
  } else {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geom = new STLLoader().parse(buffer);
    const { Mesh, MeshStandardMaterial } = await import("three");
    root = new Mesh(geom, new MeshStandardMaterial());
  }

  const meshes = collectMeshes(root);
  let triangles = 0;
  for (const m of meshes) triangles += m.positions.length / 9;
  const hasVertexColors = meshes.some((m) => m.colors);
  return {
    name,
    kind: detected,
    detail: `${triangles.toLocaleString()} triangles${hasVertexColors ? ", vertex colors" : ""}`,
    resample: (count) => sampleMesh(root, { count, targetSize: TARGET_WORLD_SIZE }),
  };
}

/**
 * Choose the screensaver source from an installed-sources folder listing:
 * exact match on `preferred` first, then the first image. Pure + testable.
 */
export function pickInstalledSource(
  list: string[],
  preferred?: string | null
): string | null {
  if (list.length === 0) return null;
  if (preferred) {
    const lower = preferred.toLowerCase();
    for (const name of list) {
      if (name.toLowerCase() === lower) return name;
    }
  }
  return list[0];
}

/** Fetch a source over HTTP (used by the ?src= demo hook and future screensaver config). */
export async function loadSourceFromUrl(url: string, count?: number): Promise<{
  handle: SourceHandle;
  sample: FlatSource;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch source ${url}: ${res.status}`);
  const name = url.split("/").pop() ?? url;
  const blob = await res.blob();
  const handle = await loadSource(name, blob);
  return { handle, sample: handle.resample(count ?? 12000) };
}
