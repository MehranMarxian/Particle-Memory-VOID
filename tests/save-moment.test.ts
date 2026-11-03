import { describe, expect, it, vi } from "vitest";
import { deliverMoment, type MomentShare } from "@/app/saveMoment";

const blob = new Blob(["moment"], { type: "image/png" });

function run(preferShare: boolean, nav: MomentShare) {
  const download = vi.fn();
  return deliverMoment(blob, "void.png", { preferShare, nav, download }).then((outcome) => ({ outcome, download }));
}

describe("where a moment goes", () => {
  it("a touch device offers the file to the share sheet", async () => {
    const share = vi.fn(() => Promise.resolve());
    const { outcome, download } = await run(true, { canShare: () => true, share });
    expect(outcome).toBe("shared");
    expect(download).not.toHaveBeenCalled();
    const sent = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0];
    expect(sent.name).toBe("void.png");
    expect(sent.type).toBe("image/png");
  });

  it("closing the sheet saves nothing and says nothing", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    const { outcome, download } = await run(true, { canShare: () => true, share: () => Promise.reject(abort) });
    expect(outcome).toBe("cancelled");
    expect(download).not.toHaveBeenCalled();
  });

  it("a refused share still saves the moment", async () => {
    const refused = Object.assign(new Error("no gesture"), { name: "NotAllowedError" });
    const { outcome, download } = await run(true, { canShare: () => true, share: () => Promise.reject(refused) });
    expect(outcome).toBe("saved");
    expect(download).toHaveBeenCalledOnce();
  });

  it("a browser that cannot share files downloads", async () => {
    const share = vi.fn(() => Promise.resolve());
    const { outcome } = await run(true, { canShare: () => false, share });
    expect(outcome).toBe("saved");
    expect(share).not.toHaveBeenCalled();
    expect((await run(true, {})).outcome).toBe("saved");
  });

  it("a desktop downloads even when it could share", async () => {
    const share = vi.fn(() => Promise.resolve());
    const { outcome } = await run(false, { canShare: () => true, share });
    expect(outcome).toBe("saved");
    expect(share).not.toHaveBeenCalled();
  });
});
