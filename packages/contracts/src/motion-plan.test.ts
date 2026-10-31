import {describe,it,expect} from 'vitest';
import {expandMotionBeat,motionIssues} from './motion-plan.ts';
import type {LecturePerformance} from './course-package.ts';
type Beat=LecturePerformance['units'][number]['beats'][number];
const base:Beat={text:'まず説明します。黒板で考えましょう。答えは五です。スライドへ戻ります。',targetId:null,camera:'lecture',position:'right',surface:'slides'};
describe('text anchored motion queue',()=>{
 it('preserves speech exactly and derives board preparation from one script',()=>{
  const text=base.text, start=text.indexOf('黒板'),end=text.indexOf('答え'),back=text.indexOf('スライド');
  const result=expandMotionBeat({...base,motions:[{id:'board',kind:'board',start,end,quote:text.slice(start,end),markdown:'答えは5'},{id:'back',kind:'slides',start:back,end:text.length,quote:text.slice(back)}]});
  expect(result.flatMap(b=>[b.transitionText??'',b.text]).join('')).toBe(text);
  expect(result.map(b=>b.surface)).toEqual(['slides','board','slides']);
  expect(result[1]?.transitionText).toBe('黒板で考えましょう。');
  expect(result[1]?.text).toBe('答えは五です。');
  expect(result[2]?.walkWhileSpeaking).toBe(true);
 });
 it('reanchors pointing when motion boundaries split a spoken passage',()=>{
  const result=expandMotionBeat({...base,pointing:{mode:'manual',cues:[{id:'p',start:0,end:12,quote:base.text.slice(0,12),targetId:'target'}]},motions:[{id:'m',kind:'left',start:4,end:8,quote:base.text.slice(4,8)}]});
  expect(result[1]?.position).toBe('left');
  expect(result[1]?.pointing?.mode).toBe('off');
  expect(result[2]?.pointing?.cues[0]).toMatchObject({start:0,end:4,quote:base.text.slice(8,12)});
  expect(result.map(b=>b.text).join('')).toBe(base.text);
 });
 it('rejects stale, overlapping, and unfinished board explanations',()=>{
  expect(motionIssues({...base,motions:[{id:'x',kind:'nod',start:0,end:2,quote:'変更'}]})).not.toEqual([]);
  expect(()=>expandMotionBeat({...base,motions:[{id:'x',kind:'board',start:0,end:base.text.length,quote:base.text,markdown:'5'}]})).toThrow();
  expect(motionIssues({...base,motions:[{id:'x',kind:'left',start:0,end:4,quote:base.text.slice(0,4)},{id:'y',kind:'right',start:2,end:6,quote:base.text.slice(2,6)}]})).toContain('動作の区間が重複しています');
 });
});
