import { expect, it, vi } from "vitest";
import { trackSpeechPlayback } from "./speech-playback.ts";

it("reports loading and a stalled clock, then follows playback and stops after disposal", () => {
 vi.useFakeTimers();
 const media=Object.assign(new EventTarget(),{duration:Infinity,currentTime:0,ended:false,error:null});
 const report=vi.fn(),stop=trackSpeechPlayback(media as unknown as HTMLMediaElement,3000,500,report);
 try {
  expect(report).toHaveBeenLastCalledWith(2500,"waiting");
  vi.advanceTimersByTime(1500);expect(report).toHaveBeenCalledTimes(1);
  media.duration=3;media.currentTime=.5;media.dispatchEvent(new Event("playing"));
  vi.advanceTimersByTime(1000);expect(report).toHaveBeenLastCalledWith(2500,"playing");
  media.currentTime=2;vi.advanceTimersByTime(1500);expect(report).toHaveBeenLastCalledWith(1000,"playing");
  media.ended=true;media.dispatchEvent(new Event("ended"));expect(report).toHaveBeenLastCalledWith(0,"ended");
  const endedCount=report.mock.calls.length;vi.advanceTimersByTime(2000);expect(report).toHaveBeenCalledTimes(endedCount+1);
  expect(report).toHaveBeenLastCalledWith(0,"ended");
  stop();const count=report.mock.calls.length;vi.advanceTimersByTime(2000);media.dispatchEvent(new Event("playing"));expect(report).toHaveBeenCalledTimes(count);
 }finally{stop();vi.useRealTimers();}
});

it("does not use the previous utterance clock when a board narration is being prepared",async()=>{
 const {currentSpeechClock}=await import("./speech-playback.ts");
 const audio={currentTime:20,duration:20,getAttribute:()=>"/intro.wav"} as unknown as HTMLMediaElement;
 expect(currentSpeechClock(audio,{playing:false,audioUrl:"/intro.wav"})).toBeNull();
 expect(currentSpeechClock(audio,{playing:true,audioUrl:"/diagram.wav"})).toBeNull();
 expect(currentSpeechClock(audio,{playing:true,audioUrl:"/intro.wav"})).toEqual({elapsed:20,duration:20});
});
