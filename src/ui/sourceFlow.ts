import type { SourceKind } from "@/sources/types";

/**
 * Source lifecycle as a pure state machine so the UI card can never show a
 * contradictory state (e.g. an error clobbering a healthy loaded memory).
 *
 * empty -> loading (reading -> processing) -> ready
 *                                     \-> error -> (retry) loading
 *
 * A `failed` event is only honored while loading: a late failure from an
 * abandoned load never corrupts the current valid source.
 */
export type SourceUiState =
  | { phase: "empty" }
  | { phase: "loading"; name: string; stage: "reading" | "processing"; hadValid: boolean }
  | { phase: "error"; name: string; message: string; hadValid: boolean }
  | { phase: "ready"; name: string; kind: SourceKind | "synthetic"; detail: string; count: number };

export type SourceUiEvent =
  | { type: "begin"; name: string }
  | { type: "processing" }
  | { type: "ready"; name: string; kind: SourceKind | "synthetic"; detail: string; count: number }
  | { type: "failed"; message: string }
  | { type: "cleared" };

export function kindLabel(kind: SourceKind | "synthetic"): string {
  switch (kind) {
    case "image":
      return "IMAGE";
    case "mesh":
      return "3D MODEL";
    case "pointcloud":
      return "POINT CLOUD";
    default:
      return "SYNTHETIC";
  }
}

export function nextSourceUiState(current: SourceUiState, event: SourceUiEvent): SourceUiState {
  switch (event.type) {
    case "begin":
      return { phase: "loading", name: event.name, stage: "reading", hadValid: current.phase === "ready" };
    case "processing":
      return current.phase === "loading" ? { ...current, stage: "processing" } : current;
    case "ready":
      return { phase: "ready", name: event.name, kind: event.kind, detail: event.detail, count: event.count };
    case "failed":
      return current.phase === "loading"
        ? { phase: "error", name: current.name, message: event.message, hadValid: current.hadValid }
        : current;
    case "cleared":
      return { phase: "empty" };
  }
}
