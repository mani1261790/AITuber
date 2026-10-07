import {expect,it} from "vitest";
import {levelAt,speechEnvelope} from "./speech-envelope.ts";
it("closes during silence and follows sound energy instead of a periodic clock",()=>{
 const samples=new Float32Array(48000);
 for(let i=4800;i<14400;i++)samples[i]=.12*Math.sin(i*.15);
 for(let i=24000;i<33600;i++)samples[i]=.025*Math.sin(i*.15);
 const levels=speechEnvelope([samples],48000);
 expect(levelAt(levels,.04)).toBe(0);expect(levelAt(levels,.4)).toBe(0);expect(levelAt(levels,1.2)).toBe(0);
 expect(levelAt(levels,.2)).toBeGreaterThan(.5);expect(levelAt(levels,.6)).toBeLessThan(levelAt(levels,.2));expect(levelAt(levels,.6)).toBeGreaterThan(0);
});
it("does not cancel opposite-phase stereo and interpolates when playback seeks",()=>{
 const left=new Float32Array(960).fill(.1),right=new Float32Array(960).fill(-.1);
 expect(speechEnvelope([left,right],48000)[0]).toBeGreaterThan(.6);
 expect(levelAt(new Float32Array([0,.8,0]),.01)).toBeCloseTo(.4);
 expect(levelAt(new Float32Array([0,.8,0]),.04)).toBe(0);
});
