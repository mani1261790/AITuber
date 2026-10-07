/** Phrase-level activity, not syllable-by-syllable arm pumping. */
export class SpeechGesture {
  private silence = 0;
  private strength = 0;
  private phraseLevel = 0;
  private phraseAge = 0;
  update(delta: number, speaking: boolean, level: number | undefined) {
    const dt = Math.min(Math.max(delta, 0), 1 / 30);
    const voiced = speaking && (level === undefined || level > .045);
    if (voiced && this.silence >= .45) this.phraseAge = 0;
    this.silence = voiced ? 0 : this.silence + dt;
    if (voiced) this.phraseAge += dt;
    // Smooth vocal energy over phrases; retain it across short punctuation pauses.
    if(voiced){
      const energy=level===undefined?1:Math.max(0,Math.min(1,(level-.045)/.555));
      this.phraseLevel+=(energy-this.phraseLevel)*(1-Math.exp(-dt*2.5));
    }
    // Let the opening gesture settle during a sustained explanation. A new
    // phrase after a real pause renews it; punctuation does not pump the arms.
    const progress = Math.max(0, Math.min(1, (this.phraseAge - 3.5) / 4));
    const phraseEnvelope = 1 - .65 * progress * progress * (3 - 2 * progress);
    const intensity=(level===undefined?1:.45+.55*this.phraseLevel) * phraseEnvelope;
    const target = speaking && (voiced || this.silence < .3) ? intensity : 0;
    this.strength += (target - this.strength) * (1 - Math.exp(-dt * (target ? 6 : 3)));
    return this.strength;
  }
}
