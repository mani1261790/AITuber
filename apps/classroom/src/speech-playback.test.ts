import { expect, it, vi } from "vitest";
import { trackSpeechPlayback } from "./speech-playback.ts";

it("reports loading and a stalled clock, then follows playback and stops after disposal", () => {
 vi.useFakeTimers();
 const media=Object.assign(new EventTarget(),{duration:Infinity,currentTime:0,ended:false,error:null});
 const report=vi.fn(),stop=trackSpeechPlayback(media as unknown as HTMLMediaElement,3000,500,report);
 try {
  expect(report).toHaveBeenLastCalledWith(2500);
  vi.advanceTimersByTime(1500);expect(report).toHaveBeenCalledTimes(4);
  media.duration=3;media.currentTime=.5;media.dispatchEvent(new Event("playing"));
  vi.advanceTimersByTime(1000);expect(report).toHaveBeenLastCalledWith(2500);
  media.currentTime=2;vi.advanceTimersByTime(500);expect(report).toHaveBeenLastCalledWith(1000);
  media.ended=true;media.dispatchEvent(new Event("ended"));expect(report).toHaveBeenLastCalledWith(0);
  const endedCount=report.mock.calls.length;vi.advanceTimersByTime(1500);expect(report).toHaveBeenCalledTimes(endedCount);
  stop();const count=report.mock.calls.length;vi.advanceTimersByTime(2000);media.dispatchEvent(new Event("playing"));expect(report).toHaveBeenCalledTimes(count);
 }finally{stop();vi.useRealTimers();}
});
