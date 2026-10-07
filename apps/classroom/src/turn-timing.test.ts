import { expect, it } from "vitest";
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { createTurnProgress, defaultTurnProgress } from "./turn-timing.ts";

const clip = (angles: number[], times = angles.map((_, i) => i / (angles.length - 1))) => new AnimationClip("turn", 1, [
  new QuaternionKeyframeTrack("hips.quaternion", times, angles.flatMap(angle => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).toArray())),
]);

it("keeps an authored late pivot instead of replacing it with a symmetric turn", () => {
  for (const sign of [-1, 1]) {
    const source = clip([0, .04, .2, .85, 1.5].map(v => v * sign));
    const before = Array.from(source.tracks[0]!.values), sample = createTurnProgress(source, "hips");
    expect(sample(.5)).toBeCloseTo(.2 / 1.5);
    expect(sample(.75)).toBeCloseTo(.85 / 1.5);
    expect(sample(.5)).toBeLessThan(defaultTurnProgress(.5) - .3);
    expect(Array.from(source.tracks[0]!.values)).toEqual(before);
  }
});

it("does not reverse or overshoot, and joins samples with continuous velocity", () => {
  const sample = createTurnProgress(clip([0, .1, .08, .8, 1.5]), "hips");
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const value = sample(i / 1000);
    expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
    expect(value).toBeLessThanOrEqual(1);
    previous = value;
  }
  const h = 1e-5;
  for (const t of [.25, .5, .75]) {
    const left = (sample(t) - sample(t - h)) / h, right = (sample(t + h) - sample(t)) / h;
    expect(Math.abs(left - right)).toBeLessThan(.003);
  }
  expect(sample(h) / h).toBeLessThan(.001);
  expect((1 - sample(1 - h)) / h).toBeLessThan(.001);
});

it("unwraps a pivot across pi and falls back for missing or stationary yaw", () => {
  const sample = createTurnProgress(clip([2.9, 3.1, 3.5, 4.2]), "hips");
  expect(sample(1 / 3)).toBeCloseTo(.2 / 1.3);
  expect(sample(1)).toBe(1);
  expect(createTurnProgress(clip([0, 0, 0]), "hips")(.3)).toBe(defaultTurnProgress(.3));
  expect(createTurnProgress(clip([0, 1]), "missing")(.3)).toBe(defaultTurnProgress(.3));
});
