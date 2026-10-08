/**
 * Recording (0.12 slice 5), a lazy chunk: the canvas as the visitor sees
 * it - the whole light chain - plus the soundscape, to a WebM file made in
 * the browser (MediaRecorder). While it runs, a REC mark with the elapsed
 * time sits at the top of the screen; it is never in the recording, which
 * takes the canvas alone.
 */
export interface Recording {
  stop(): void;
}

const MIME_CHOICES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

/** The first WebM type this browser can record, or null. */
export function pickMime(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string | null {
  return MIME_CHOICES.find((t) => isSupported(t)) ?? null;
}

/** "m:ss" for the REC mark. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Start recording `canvas` (and `audio`, when given). `onDone` gets the
 * file when it stops. Returns a message instead when recording cannot
 * start here.
 */
export function startRecording(
  canvas: HTMLCanvasElement,
  audio: MediaStream | null,
  onDone: (blob: Blob) => void
): Recording | string {
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") return "THIS BROWSER CANNOT RECORD";
  const mime = pickMime();
  if (!mime) return "THIS BROWSER CANNOT RECORD WEBM";
  const stream = canvas.captureStream(60);
  for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  } catch {
    return "THIS BROWSER CANNOT RECORD";
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // The REC mark: outside the canvas, so never in the film.
  const mark = document.createElement("div");
  mark.setAttribute("role", "status");
  mark.setAttribute("aria-live", "off");
  Object.assign(mark.style, {
    position: "fixed",
    top: "10px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "40",
    font: "11px/1 ui-monospace, monospace",
    letterSpacing: "0.18em",
    color: "#e9e4d4",
    background: "rgba(0,0,0,0.55)",
    padding: "6px 10px",
    borderRadius: "4px",
    pointerEvents: "none",
  });
  const start = performance.now();
  const paint = () => (mark.textContent = `● REC ${elapsedLabel(performance.now() - start)}`);
  paint();
  document.body.appendChild(mark);
  const timer = window.setInterval(paint, 500);

  recorder.onstop = () => {
    window.clearInterval(timer);
    mark.remove();
    for (const t of stream.getVideoTracks()) t.stop();
    onDone(new Blob(chunks, { type: mime.split(";")[0] }));
  };
  recorder.start(1000);
  return {
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
    },
  };
}
