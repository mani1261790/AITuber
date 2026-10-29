/** Reports actual media events. End/error reports repeat until the next snapshot disposes this tracker. */
export function trackSpeechPlayback(audio: HTMLMediaElement, estimatedDurationMs: number, offsetMs: number, report: (remainingMs: number, state: "playing" | "waiting" | "ended" | "error") => void) {
  let playing=false,hasPlayed=false;
  const finished=()=>audio.ended || (hasPlayed && Number.isFinite(audio.duration) && audio.duration>0 && audio.currentTime>=audio.duration);

  const update = () => {
    const state=audio.error ? "error" : finished() ? "ended" : playing ? "playing" : "waiting";
    const remaining = finished() ? 0 : Number.isFinite(audio.duration)
      ? (audio.duration - audio.currentTime) * 1000 : estimatedDurationMs - offsetMs;
    report(Math.max(0,remaining),state);
  };
  const start=()=>{playing=true;hasPlayed=true;update();};
  const wait=()=>{playing=false;update();};
  audio.addEventListener("playing",start);
  for(const event of ["waiting","pause","seeking"]) audio.addEventListener(event,wait);
  for(const event of ["ended","error"]) audio.addEventListener(event,update);
  // Some media engines reach the exact end before dispatching ended. Observe
  // the media clock as well; never infer completion from an estimated duration.
  const atEnd=()=>{if(finished())update();};
  audio.addEventListener("timeupdate",atEnd);
  const foreground=()=>{if(document.visibilityState==="visible")update();};
  if(typeof document!=="undefined")document.addEventListener("visibilitychange",foreground);
  update();
  const timer=setInterval(update,2000);
  return ()=>{
    clearInterval(timer);
    audio.removeEventListener("timeupdate",atEnd);
    if(typeof document!=="undefined")document.removeEventListener("visibilitychange",foreground);
    audio.removeEventListener("playing",start);
    for(const event of ["waiting","pause","seeking"]) audio.removeEventListener(event,wait);
    for(const event of ["ended","error"]) audio.removeEventListener(event,update);
  };
}

/** A previous utterance's ended element must never advance the next board drawing. */
export function currentSpeechClock(audio: HTMLMediaElement | null, speech: {playing:boolean;audioUrl?:string|null}) {
  if (!audio || !speech.playing || !speech.audioUrl || audio.getAttribute("src") !== speech.audioUrl || !Number.isFinite(audio.duration) || audio.duration <= 0) return null;
  return {elapsed:audio.currentTime,duration:audio.duration};
}
