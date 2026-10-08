import { describe, expect, it } from "vitest";
import { lecturePixelRatio } from "./render-resolution.ts";

describe("lecture render resolution", () => {
  it("supersamples a standard display and retains Retina detail", () => {
    expect(lecturePixelRatio(1280,720,1)).toBe(3);
    expect(lecturePixelRatio(1280,720,2)).toBe(4);
  });
  it("bounds GPU allocation at 4K and on tall screens", () => {
    for (const [w,h] of [[3840,2160],[1080,4000],[10000,100]]) {
      const ratio=lecturePixelRatio(w!,h!,3,4096);
      expect(w!*h!*ratio*ratio).toBeLessThanOrEqual(16_588_801);
      expect(Math.max(w!,h!)*ratio).toBeLessThanOrEqual(4096);
    }
  });
  it("handles hidden containers and invalid device ratios", () => {
    expect(lecturePixelRatio(0,0,NaN)).toBe(3);
  });
});
