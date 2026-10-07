/** Keep the lecture informed while metadata loads or the media clock stalls. */
export function trackSpeechPlayback(audio: HTMLMediaElement, estimatedDurationMs: number, offsetMs: number, report: (remainingMs: number) => void) {
  let completed = false;
  const update = () => {
    if (audio.error || completed) return;
    completed = audio.ended;
    const remaining = audio.ended ? 0 : Number.isFinite(audio.duration)
      ? (audio.duration - audio.currentTime) * 1000
      : estimatedDurationMs - offsetMs;
    report(Math.max(0, remaining));
  };
  audio.addEventListener("playing", update);
  audio.addEventListener("ended", update);
  update();
  const timer = setInterval(update, 500);
  return () => {
    clearInterval(timer);
    audio.removeEventListener("playing", update);
    audio.removeEventListener("ended", update);
  };
}
