import { expect, it } from "vitest";
import { TeacherBlink } from "./teacher-blink.ts";

it("closes fully, opens more slowly, and varies the following interval", () => {
  let index = 0;
  const blink = new TeacherBlink(() => [0, 1, .5][index++ % 3]!);
  const events: { start: number; peak: number; end: number }[] = [];
  let active: { start: number; peak: number; end: number } | null = null;
  for (let i = 0; i < 1800; i++) {
    const v = blink.update(1 / 120);
    expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
    if (v > 0 && !active) active = { start: i, peak: 0, end: 0 };
    if (v === 1 && active && !active.peak) active.peak = i;
    if (v === 0 && active) { active.end = i; events.push(active); active = null; }
  }
  expect(events.length).toBeGreaterThanOrEqual(3);
  for (const event of events) expect(event.end - event.peak).toBeGreaterThan(event.peak - event.start);
  expect(events[1]!.start - events[0]!.end).toBeGreaterThan(events[2]!.start - events[1]!.end);
});

it("does not skip the entire blink after a long frame", () => {
  const blink = new TeacherBlink(() => 0);
  for (let i = 0; i < 83; i++) blink.update(1 / 30);
  const values = [blink.update(10), blink.update(1 / 30), blink.update(1 / 30)];
  expect(Math.max(...values)).toBeGreaterThan(.9);
});
