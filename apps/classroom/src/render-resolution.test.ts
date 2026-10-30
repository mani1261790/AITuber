import { describe, expect, it } from "vitest";
import { lecturePixelRatio } from "./render-resolution.ts";

describe("lecture render resolution", () => {
  it("matches standard displays and retains bounded Retina detail", () => {
    expect(lecturePixelRatio(1280,720,1)).toBe(1);
    expect(lecturePixelRatio(1920,1080,1)).toBe(1);
    expect(lecturePixelRatio(1280,720,2)).toBe(2);
  });
  it("bounds GPU allocation at 4K and on tall screens", () => {
    for (const [w,h] of [[3840,2160],[1080,4000],[10000,100]]) {
      const ratio=lecturePixelRatio(w!,h!,3,4096);
      expect(w!*h!*ratio*ratio).toBeLessThanOrEqual(4_147_201);
      expect(Math.max(w!,h!)*ratio).toBeLessThanOrEqual(4096);
    }
  });
  it("handles hidden containers and invalid device ratios", () => {
    expect(lecturePixelRatio(0,0,NaN)).toBe(1);
  });
});
