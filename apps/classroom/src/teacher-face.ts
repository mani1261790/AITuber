import type { TeachingGesture } from "@aituber/contracts";

/** Small teaching expressions, independent of the individual mouth-open frames. */
export class TeacherFace {
  private happy = 0;
  private relaxed = 0;
  update(delta: number, speaking: boolean, reacting: boolean, gesture?: TeachingGesture, acknowledgement = 0) {
    const dt = Math.min(Math.max(delta, 0), 1 / 30);
    const listening = !speaking && gesture === "listen";
    // Follow the performed nod, not a gesture label that can remain for the whole beat.
    const baseline = speaking ? .12 : .02;
    const happy = reacting ? .45 : baseline + (.22-baseline)*Math.max(0,Math.min(1,acknowledgement));
    const relaxed = listening ? .16 : 0;
    const blend = 1 - Math.exp(-dt * 5);
    this.happy += (happy - this.happy) * blend;
    this.relaxed += (relaxed - this.relaxed) * blend;
    return { happy: this.happy, relaxed: this.relaxed };
  }
}
