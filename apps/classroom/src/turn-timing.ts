import { AnimationClip, Euler, MathUtils, Quaternion } from "three";

export const defaultTurnProgress = (progress: number) => MathUtils.smootherstep(progress, 0, 1);

/** Preserve the turn clip's pelvis timing after extracting its yaw from the pose.
 * Monotone Hermite interpolation avoids adding backwards pivots or keyframe jerks.
 */
export function createTurnProgress(clip: AnimationClip, hipsName: string | undefined) {
  const track = clip.tracks.find(track => track.name === `${hipsName}.quaternion`);
  if (!track || track.times.length < 2 || clip.duration <= 0) return defaultTurnProgress;
  const q = new Quaternion(), e = new Euler(0, 0, 0, "YXZ");
  const times = Array.from(track.times, time => time / clip.duration);
  const angles: number[] = [];
  for (let i = 0; i < times.length; i++) {
    e.setFromQuaternion(q.fromArray(track.values, i * 4), "YXZ");
    const previous = angles[i - 1] ?? e.y;
    angles.push(previous + Math.atan2(Math.sin(e.y - previous), Math.cos(e.y - previous)));
  }
  const first = angles[0]!, extent = angles.at(-1)! - first;
  if (angles.some(angle => !Number.isFinite(angle)) || Math.abs(extent) < .2 || times.some((time, i) => !Number.isFinite(time) || (i > 0 && time <= times[i - 1]!))) return defaultTurnProgress;
  let previous = 0;
  const values = angles.map(angle => previous = Math.max(previous, MathUtils.clamp((angle - first) / extent, 0, 1)));
  const slopes = times.slice(1).map((time, i) => (values[i + 1]! - values[i]!) / (time - times[i]!));
  const tangents = values.map((_, i) => {
    if (i === 0 || i === values.length - 1) return 0;
    const a = slopes[i - 1]!, b = slopes[i]!;
    if (a <= 0 || b <= 0) return 0;
    const before = times[i]! - times[i - 1]!, after = times[i + 1]! - times[i]!;
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / a + w2 / b);
  });
  return (progress: number) => {
    if (progress <= times[0]!) return 0;
    if (progress >= times.at(-1)!) return 1;
    const right = times.findIndex(time => time > progress), left = right - 1;
    const span = times[right]! - times[left]!, t = (progress - times[left]!) / span;
    return (2*t*t*t-3*t*t+1)*values[left]! + (t*t*t-2*t*t+t)*span*tangents[left]!
      + (-2*t*t*t+3*t*t)*values[right]! + (t*t*t-t*t)*span*tangents[right]!;
  };
}
