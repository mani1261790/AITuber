import {afterEach,expect,it,vi} from "vitest";
import {startSpeechAudio} from "./speech-audio.ts";
class AudioStub extends EventTarget {
 currentTime=0;duration=5;readyState=1;volume=1;
 error: {code:number;message:string}|null=null;
 play=vi.fn(()=>Promise.resolve());
 load=vi.fn(()=>{this.error=null;this.currentTime=0;this.readyState=0;});
 fail(message="PipelineStatus::AUDIO_RENDERER_ERROR: audio render error") {this.error={code:3,message};this.dispatchEvent(new Event("error"));}
 metadata(){this.readyState=1;this.dispatchEvent(new Event("loadedmetadata"));}
}
afterEach(()=>vi.useRealTimers());
it("retries an output failure once at the last heard position and exposes a second failure",async()=>{
 vi.useFakeTimers();const audio=new AudioStub(),blocked=vi.fn();
 const control=startSpeechAudio(audio as unknown as HTMLAudioElement,500,blocked);
 expect(audio.currentTime).toBe(.5);
 audio.currentTime=1.4;audio.dispatchEvent(new Event("timeupdate"));audio.fail();
 await vi.advanceTimersByTimeAsync(250);audio.metadata();
 expect(audio.currentTime).toBe(1.4);expect(audio.load).toHaveBeenCalledTimes(1);
 expect(audio.play).toHaveBeenCalledTimes(2);
 audio.fail();await vi.advanceTimersByTimeAsync(1000);
 expect(audio.load).toHaveBeenCalledTimes(1);expect(blocked).toHaveBeenLastCalledWith(true);
 control.dispose();
});
it("does not reload unsupported media automatically and lets a user retry",async()=>{
 vi.useFakeTimers();const audio=new AudioStub(),blocked=vi.fn();
 const control=startSpeechAudio(audio as unknown as HTMLAudioElement,0,blocked);
 audio.currentTime=2;audio.fail("unsupported codec");await vi.advanceTimersByTimeAsync(1000);
 expect(audio.load).not.toHaveBeenCalled();expect(blocked).toHaveBeenLastCalledWith(true);
 control.retry();audio.metadata();await Promise.resolve();
 expect(audio.currentTime).toBe(2);expect(blocked).toHaveBeenLastCalledWith(false);
 control.dispose();
});
it("cancels recovery on a source change or unmount",async()=>{
 vi.useFakeTimers();const audio=new AudioStub(),blocked=vi.fn();
 const control=startSpeechAudio(audio as unknown as HTMLAudioElement,0,blocked);
 audio.fail();control.dispose();blocked.mockClear();
 await vi.advanceTimersByTimeAsync(1000);control.retry();audio.metadata();
 expect(audio.load).not.toHaveBeenCalled();expect(blocked).not.toHaveBeenCalled();
});
it("ignores a late rejection from an older playback attempt",async()=>{
 const audio=new AudioStub(),blocked=vi.fn();let rejectOld!: (error: Error)=>void;
 audio.play.mockImplementationOnce(()=>new Promise<void>((_,reject)=>{rejectOld=reject;}));
 const control=startSpeechAudio(audio as unknown as HTMLAudioElement,0,blocked);
 control.retry();await Promise.resolve();blocked.mockClear();
 rejectOld(new Error("old output failed"));await Promise.resolve();await Promise.resolve();
 expect(blocked).not.toHaveBeenCalled();control.dispose();
});
it.each([0,.021333])("does not rewind the initial audio packet (%s seconds) on metadata arrival",(time)=>{
 const audio=new AudioStub(),setTime=vi.fn();
 Object.defineProperty(audio,"currentTime",{get:()=>time,set:setTime});
 const control=startSpeechAudio(audio as unknown as HTMLAudioElement,0,vi.fn());
 audio.metadata();
 expect(setTime).not.toHaveBeenCalled();
 expect(audio.play).toHaveBeenCalledTimes(1);
 control.dispose();
});
