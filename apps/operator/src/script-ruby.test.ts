import {expect,it} from 'vitest';
import {applyRuby,formatRuby,parseRuby} from './script-ruby.ts';
import type {CoursePackage} from '@aituber/contracts';
it('round trips punctuation and literal ruby delimiters without changing original text',()=>{
 const text='言語｜《モデル》\\';const reading={text,parts:[{text,reading:'げんごモデル'}]};
 expect(parseRuby(formatRuby(text,reading))).toEqual([{text}]);expect(parseRuby(formatRuby(text))).toEqual([{text}]);
});
it('rejects incomplete or ambiguous markup rather than silently changing speech',()=>{
 for(const input of ['｜言語《げんご','言語《げんご》','｜《げんご》','｜言語《Language》'])expect(()=>parseRuby(input)).toThrow();
});
it('keeps manual pronunciation as a preference when edited text needs automatic conversion',()=>{
 const course={performance:{version:1,units:[{unitId:'unit.one',beats:[{text:'LLMを使う。',targetId:null,camera:'lecture',position:'right'}]}],readings:[{text:'LLMを使う。',parts:[{text:'LLM',reading:'エルエルエム'},{text:'を使う。',reading:'をつかう。'}]}]},pronunciationDictionary:[]} satisfies Pick<CoursePackage,'performance'|'pronunciationDictionary'>;
 applyRuby(course,'unit.one',0,'｜LLM《ラージランゲージモデル》を試そう。');
 expect(course.performance!.units[0]!.beats[0]!.text).toBe('LLMを試そう。');
 expect(course.pronunciationDictionary).toEqual([{surface:'LLM',reading:'ラージランゲージモデル'}]);
 expect(course.performance!.readings.find(item=>item.text==='LLMを試そう。')?.parts).toEqual([{text:'LLM',reading:'ラージランゲージモデル'},{text:'を試そう。',reading:'を試そう。'}]);
});
it('does not allow kanji ruby overrides',()=>{expect(()=>parseRuby('｜言語《げんご》')).toThrow('英字');});
it('formats Latin ruby while keeping Japanese unchanged',()=>{
 const text='LLMは大規模言語モデルです。';expect(formatRuby(text,{text,parts:[{text:'LLM',reading:'エルエルエム'},{text:'は大規模言語モデルです。',reading:'は大規模言語モデルです。'}]})).toBe('｜LLM《エルエルエム》は大規模言語モデルです。');
});
it('preserves Windows paths and unrecognized escape sequences',()=>{
 expect(parseRuby(String.raw`C:\Users\mani\file.txt`)).toEqual([{text:String.raw`C:\Users\mani\file.txt`}]);
});
it('shows saved manual readings while the rest of an edited sentence awaits conversion',()=>{
 expect(formatRuby('LLMを使います。',undefined,[{surface:'LLM',reading:'エルエルエム'}])).toBe('｜LLM《エルエルエム》を使います。');
});
