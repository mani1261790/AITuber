import { describe, expect, it } from "vitest";
import { resolveMascotPresentation } from "./mascot-state.ts";

const segment = { startMs: 100, endMs: 1_000 };

describe("resolveMascotPresentation", () => {
  it("keeps the normal pose with a closed mouth outside audible speech", () => {
    expect(resolveMascotPresentation({ audiblePlayback: false, elapsedMs: 120, segment, targetId: null, targetLabel: null, reactionActive: false }))
      .toEqual({ state: "normal", mouthOpen: false, targetId: null, announcement: "講義を見守っています" });
  });

  it("opens and closes the mouth from the active speech segment timestamp", () => {
    expect(resolveMascotPresentation({ audiblePlayback: true, elapsedMs: 120, segment, targetId: null, targetLabel: null, reactionActive: false }).state).toBe("mouth-open");
    expect(resolveMascotPresentation({ audiblePlayback: true, elapsedMs: 280, segment, targetId: null, targetLabel: null, reactionActive: false }).mouthOpen).toBe(false);
    expect(resolveMascotPresentation({ audiblePlayback: true, elapsedMs: 1_000, segment, targetId: null, targetLabel: null, reactionActive: false }).mouthOpen).toBe(false);
  });

  it("points to the active semantic target while preserving lip sync", () => {
    expect(resolveMascotPresentation({ audiblePlayback: true, elapsedMs: 120, segment, targetId: "target.formula", targetLabel: "頂点形式", reactionActive: false }))
      .toEqual({ state: "pointing", mouthOpen: true, targetId: "target.formula", announcement: "頂点形式を案内しています" });
  });

  it("closes the mouth immediately when playback stops while pointing", () => {
    expect(resolveMascotPresentation({ audiblePlayback: false, elapsedMs: 120, segment, targetId: "target.formula", targetLabel: "頂点形式", reactionActive: false }))
      .toEqual({ state: "pointing", mouthOpen: false, targetId: "target.formula", announcement: "頂点形式を案内しています" });
  });

  it("shows a short reaction with a closed mouth", () => {
    expect(resolveMascotPresentation({ audiblePlayback: true, elapsedMs: 120, segment, targetId: "target.formula", targetLabel: "頂点形式", reactionActive: true }))
      .toEqual({ state: "reaction", mouthOpen: false, targetId: null, announcement: "節目に反応しています" });
  });
});
