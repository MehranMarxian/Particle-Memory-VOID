/**
 * Where a captured moment goes. A touch device offers it to the share sheet,
 * which is how a phone saves a picture or sends it on; everything else, and
 * any share the browser refuses, downloads the file. The decision is pure of
 * the page so it can be tested.
 */
export type MomentOutcome = "shared" | "saved" | "cancelled";

export interface MomentShare {
  canShare?(data: { files: File[] }): boolean;
  share?(data: { files: File[]; title: string }): Promise<void>;
}

export async function deliverMoment(
  blob: Blob,
  filename: string,
  options: { preferShare: boolean; nav: MomentShare; download(blob: Blob, filename: string): void }
): Promise<MomentOutcome> {
  const { preferShare, nav, download } = options;
  if (preferShare && nav.share) {
    const file = new File([blob], filename, { type: blob.type });
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "VOID / PARTICLE MEMORY" });
        return "shared";
      } catch (err) {
        // The visitor closed the sheet: that is an answer, not a failure.
        if ((err as Error).name === "AbortError") return "cancelled";
      }
    }
  }
  download(blob, filename);
  return "saved";
}
