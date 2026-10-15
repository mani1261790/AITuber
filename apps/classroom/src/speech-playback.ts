/** Reports actual media events. End/error reports repeat until the next snapshot disposes this tracker. */
export function trackSpeechPlayback(audio: HTMLMediaElement, estimatedDurationMs: number, offsetMs: number, report: (remainingMs: number, state: "playing" | "waiting" | "ended" | "error") => void) {
  let playing=false;
  const update = () => {
    const state=audio.error ? "error" : audio.ended ? "ended" : playing ? "playing" : "waiting";
    const remaining = audio.ended ? 0 : Number.isFinite(audio.duration)
      ? (audio.duration - audio.currentTime) * 1000 : estimatedDurationMs - offsetMs;
    report(Math.max(0,remaining),state);
  };
  const start=()=>{playing=true;update();};
  const wait=()=>{playing=false;update();};
  audio.addEventListener("playing",start);
  for(const event of ["waiting","pause","seeking"]) audio.addEventListener(event,wait);
  for(const event of ["ended","error"]) audio.addEventListener(event,update);
  update();
  const timer=setInterval(update,500);
  return ()=>{
    clearInterval(timer);
    audio.removeEventListener("playing",start);
    for(const event of ["waiting","pause","seeking"]) audio.removeEventListener(event,wait);
    for(const event of ["ended","error"]) audio.removeEventListener(event,update);
  };
}
