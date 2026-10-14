import { sampleImage } from "./imageSampler";
import { IMAGE_SAMPLE_DEFAULTS } from "./loaders";
import { TARGET_WORLD_SIZE, type FlatSource, type SourceHandle } from "./types";

/**
 * Moving memories (0.13): a short video as the memory. A lazy chunk.
 *
 * The video plays muted and loops in a hidden element; a few times a
 * second its current frame is sampled exactly as a photograph is, with the
 * same seed every time, so each particle keeps its place in the picture
 * from one frame to the next. The memory's spring does the rest: the swarm
 * is always a little behind the picture, the way a memory is.
 */

/** The long side of the sampled frame: the memory needs light, not detail. */
export const VIDEO_SAMPLE_SIZE = 192;

export async function videoHandle(name: string, blob: Blob): Promise<SourceHandle> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("VIDEO: this browser cannot play it")), { once: true });
  });
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const k = VIDEO_SAMPLE_SIZE / Math.max(vw, vh);
  const w = Math.max(1, Math.round(vw * k));
  const h = Math.max(1, Math.round(vh * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("VIDEO: no 2d context to sample it");

  const frame = (count: number): FlatSource => {
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return sampleImage(
      { width: w, height: h, data: img.data },
      { count, planeSize: TARGET_WORLD_SIZE, ...IMAGE_SAMPLE_DEFAULTS, seed: 17 }
    );
  };

  const seconds = Number.isFinite(video.duration) ? video.duration : 0;
  return {
    name,
    kind: "video",
    detail: `${vw}×${vh} video${seconds ? `, ${seconds.toFixed(1)} s` : ""}`,
    // The memory as it is now; the live hook keeps it moving.
    resample: (count) => frame(count),
    live: {
      frame,
      setPlaying(on: boolean) {
        if (on && video.paused) void video.play().catch(() => undefined);
        else if (!on && !video.paused) video.pause();
      },
      dispose() {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      },
    },
  };
}
