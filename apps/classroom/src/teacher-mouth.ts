/** Audio analysis can retain its last sample while a media element is buffering. */
export function mouthOpening(speaking: boolean, mouthOpen: boolean, time: number, audioLevel?: number) {
  if (!speaking) return 0;
  return audioLevel ?? (mouthOpen ? .32 + .52 * Math.abs(Math.sin(time * 10.5)) : 0);
}
