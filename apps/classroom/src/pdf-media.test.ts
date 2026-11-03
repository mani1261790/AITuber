import {describe,it,expect} from 'vitest';
import {mediaCueTime,type MediaMoment} from './pdf-media.ts';
const cue={id:'v',filename:'motion.mp4',start:2,end:7,quote:'動画を見る',muted:true};
const moment:MediaMoment={key:'speech',text:'今、動画を見る。',elapsedMs:0,playing:true,cues:[cue],segments:[{text:'今、',startMs:0,endMs:1000},{text:'動画を見る',startMs:1000,endMs:5000},{text:'。',startMs:5000,endMs:5100}]};
describe('PDF video follows actual narrated text',()=>{
 it('waits for the selected phrase, then uses its elapsed time',()=>{expect(mediaCueTime(cue,moment)).toBeNull();expect(mediaCueTime(cue,{...moment,elapsedMs:1000})).toBe(0);expect(mediaCueTime(cue,{...moment,elapsedMs:2400})).toBe(1.4);});
 it('ends at the selected phrase boundary',()=>{expect(mediaCueTime(cue,{...moment,elapsedMs:5000})).toBeNull();});
 it('preserves the same position while paused and seeks on resume',()=>{const paused={...moment,playing:false,elapsedMs:2400};expect(mediaCueTime(cue,paused)).toBe(1.4);expect(mediaCueTime(cue,{...paused,playing:true})).toBe(1.4);});
 it('does not guess timing when script or alignment changed',()=>{expect(mediaCueTime({...cue,quote:'old'},moment)).toBeNull();expect(mediaCueTime(cue,{...moment,segments:[]})).toBeNull();expect(mediaCueTime(cue,{...moment,text:'違う台本'})).toBeNull();});
});
