import { expect, it } from "vitest";
import { SpeechGesture } from "./speech-gesture.ts";
it("bridges brief pauses but relaxes during a longer silence and resumes smoothly",()=>{
 const gesture=new SpeechGesture();let strength=0;
 for(let i=0;i<90;i++)strength=gesture.update(1/60,true,.7);
 expect(strength).toBeGreaterThan(.97);
 for(let i=0;i<12;i++)strength=gesture.update(1/60,true,0);
 expect(strength).toBeGreaterThan(.97);
 for(let i=0;i<90;i++)strength=gesture.update(1/60,true,0);
 expect(strength).toBeLessThan(.02);
 const previous=strength;strength=gesture.update(1/60,true,.6);
 expect(strength).toBeGreaterThan(previous);expect(strength-previous).toBeLessThan(.1);
});
it("works without decoded audio and settles when playback ends",()=>{
 const gesture=new SpeechGesture();let strength=0;
 for(let i=0;i<90;i++)strength=gesture.update(1/60,true,undefined);
 expect(strength).toBeGreaterThan(.97);
 for(let i=0;i<120;i++)strength=gesture.update(1/60,false,undefined);
 expect(strength).toBeLessThan(.003);
});


it("uses quieter gestures for soft speech without tracking individual syllables",()=>{
 const soft=new SpeechGesture(),strong=new SpeechGesture();let low=0,high=0;
 for(let i=0;i<240;i++){low=soft.update(1/60,true,.12);high=strong.update(1/60,true,.7);}
 expect(low).toBeGreaterThan(.45);expect(high-low).toBeGreaterThan(.35);
 let previous=high,largestChange=0;
 for(let i=0;i<120;i++){const value=strong.update(1/60,true,i%6<3?.1:.7);largestChange=Math.max(largestChange,Math.abs(value-previous));previous=value;}
 expect(largestChange).toBeLessThan(.02);
 const before=previous;for(let i=0;i<12;i++)previous=strong.update(1/60,true,0);
 expect(Math.abs(previous-before)).toBeLessThan(.04);
});

it("settles long explanations and renews after a phrase break, not punctuation",()=>{
 const gesture=new SpeechGesture();let value=0;
 for(let i=0;i<720;i++)value=gesture.update(1/60,true,.7);
 expect(value).toBeGreaterThan(.3);expect(value).toBeLessThan(.4);
 for(let i=0;i<12;i++)gesture.update(1/60,true,0);
 for(let i=0;i<60;i++)value=gesture.update(1/60,true,.7);
 expect(value).toBeLessThan(.4);
 for(let i=0;i<36;i++)gesture.update(1/60,true,0);
 let previous=gesture.update(1/60,true,.7);
 for(let i=0;i<90;i++){
  value=gesture.update(1/60,true,.7);expect(Math.abs(value-previous)).toBeLessThan(.1);previous=value;
 }
 expect(value).toBeGreaterThan(.95);
});
