import { expect, it, vi } from "vitest";
import { initialSpeechPosition } from "./speech-start.ts";

it("does not consume a new explanation while its audio is loading", () => {
  vi.useFakeTimers();
  try {
    const snapshotOffset = 0;
    vi.advanceTimersByTime(7000);
    expect(initialSpeechPosition(snapshotOffset, 6.56)).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("preserves a late join position without adding its metadata wait", () => {
  expect(initialSpeechPosition(3062, 6.18)).toBe(3.062);
  expect(initialSpeechPosition(9000, 6.18)).toBe(6.18);
  expect(initialSpeechPosition(3062, Infinity)).toBe(3.062);
  expect(initialSpeechPosition(-1, 6.18)).toBe(0);
});
