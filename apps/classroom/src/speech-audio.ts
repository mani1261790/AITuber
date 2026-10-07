import { initialSpeechPosition } from "./speech-start.ts";

/** Recover one transient output failure without replaying the start of the utterance. */
export function startSpeechAudio(audio: HTMLAudioElement, offsetMs: number, blocked: (value: boolean) => void) {
  let disposed=false,retried=false,position=initialSpeechPosition(offsetMs,Infinity);
  let attempt=0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remember=()=>{if(Number.isFinite(audio.currentTime))position=Math.max(position,audio.currentTime);};
  const metadata=()=>{
    const target=initialSpeechPosition(position*1000,audio.duration);
    // Metadata may arrive after the first audio packet has advanced the clock.
    // Rewinding those first milliseconds causes a second playing event and
    // briefly switches off mouth animation. Recovery offsets still seek exactly.
    if(target===0 && audio.currentTime>=0 && audio.currentTime<.05)return;
    if(audio.currentTime!==target)audio.currentTime=target;
  };
  const play=()=>{
    audio.volume=.8;
    const current=++attempt;
    void audio.play().then(()=>{if(!disposed&&current===attempt&&!audio.error)blocked(false);}).catch(()=>{if(!disposed&&current===attempt&&!timer)blocked(true);});
  };
  const retry=()=>{
    if(disposed)return;
    if(timer){clearTimeout(timer);timer=undefined;}
    remember();blocked(false);audio.load();play();
  };
  const failed=()=>{
    remember();
    if(!retried && audio.error?.message.includes("AUDIO_RENDERER_ERROR")){
      retried=true;timer=setTimeout(()=>{timer=undefined;retry();},250);
    }else blocked(true);
  };
  audio.addEventListener("loadedmetadata",metadata);
  audio.addEventListener("timeupdate",remember);
  audio.addEventListener("error",failed);
  if(audio.readyState>=1)metadata();
  play();
  return { retry, dispose(){disposed=true;if(timer)clearTimeout(timer);audio.removeEventListener("loadedmetadata",metadata);audio.removeEventListener("timeupdate",remember);audio.removeEventListener("error",failed);} };
}
