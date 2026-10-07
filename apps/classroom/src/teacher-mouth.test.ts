import { expect, it } from "vitest";
import { mouthOpening } from "./teacher-mouth.ts";

it("closes during buffering even when decoded audio and the old mouth flag remain active", () => {
  expect(mouthOpening(false, true, 1, .8)).toBe(0);
  expect(mouthOpening(true, true, 1, .8)).toBe(.8);
  expect(mouthOpening(true, true, 1, 0)).toBe(0);
});

it("uses the fallback only while speaking without an audio analysis", () => {
  expect(mouthOpening(true, true, 1)).toBeGreaterThan(.3);
  expect(mouthOpening(false, true, 1)).toBe(0);
  expect(mouthOpening(true, false, 1)).toBe(0);
});
