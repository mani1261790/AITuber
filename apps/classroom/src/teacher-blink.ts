/** Time-based eyelid animation, with a quicker closing phase than opening.
 * Keep its own clock so late frames never skip a blink entirely.
 */
export class TeacherBlink {
  private untilNext: number;
  private age: number | null = null;
  constructor(private random: () => number = Math.random) {
    this.untilNext = this.interval();
  }
  private interval() { return 2.8 + this.random() * 3.4; }
  update(delta: number) {
    const dt = Math.min(Math.max(delta, 0), 1 / 30);
    if (this.age === null) {
      this.untilNext -= dt;
      if (this.untilNext > 0) return 0;
      this.age = 0;
    }
    this.age += dt;
    const close = .07, hold = .025, open = .15;
    const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
    if (this.age < close) return ease(this.age / close);
    if (this.age < close + hold) return 1;
    if (this.age < close + hold + open) return 1 - ease((this.age - close - hold) / open);
    this.age = null;
    this.untilNext = this.interval();
    return 0;
  }
}
