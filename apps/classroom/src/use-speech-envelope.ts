import {useCallback,useEffect,useRef,type RefObject} from "react";
import {levelAt,speechEnvelope} from "./speech-envelope.ts";

/** Decode a separate copy; never reroute the audible media element through Web Audio. */
export function useSpeechEnvelope(audio:RefObject<HTMLAudioElement|null>,url:string|null|undefined){
  const decoded=useRef<{url:string;levels:Float32Array}|null>(null);
  useEffect(()=>{
    decoded.current=null;if(!url)return;
    const controller=new AbortController();
    void (async()=>{
      const response=await fetch(url,{signal:controller.signal});if(!response.ok)return;
      const data=await response.arrayBuffer();if(controller.signal.aborted)return;
      const context=new OfflineAudioContext(1,1,48000);
      const buffer=await context.decodeAudioData(data);
      if(controller.signal.aborted)return;
      decoded.current={url,levels:speechEnvelope(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),buffer.sampleRate)};
    })().catch(()=>{/* Playback remains independent; unavailable analysis falls back to the speaking state. */});
    return()=>controller.abort();
  },[url]);
  return useCallback(()=>{
    const element=audio.current;if(!element||element.paused||element.ended)return 0;
    const envelope=decoded.current;
    if(!envelope||element.getAttribute("src")!==envelope.url)return undefined;
    return levelAt(envelope.levels,element.currentTime);
  },[audio]);
}
