import {expect,it} from 'vitest';
import {hasLatin,isLatinSpan,isSelectiveReading,pronunciationSpans} from './latin-readings.ts';

it('covers every Latin character across long phrases, width variants, accents and code',()=>{
 for(const text of ['a'.repeat(39)+' bです。', 'Large Language Model and Retrieval Augmented Generationを説明します。', 'ＣｈａｔＧＰＴとcafé、nai\u0308ve、𝕃𝕃𝕄、don’t、GPT-4、foo_bar.py。']){
  const spans=pronunciationSpans(text);
  expect(spans.map(p=>p.text).join('')).toBe(text);
  expect(spans.every(p=>p.text.length<=40)).toBe(true);
  for(const span of spans)expect(span.latin?isLatinSpan(span.text):!hasLatin(span.text)).toBe(true);
  const reading={text,parts:spans.map(p=>({text:p.text,reading:p.latin?'カナ':p.text}))};
  expect(isSelectiveReading(reading)).toBe(true);
  expect(hasLatin(reading.parts.map(p=>p.reading).join(''))).toBe(false);
 }
});
it('rejects partially converted and legacy kana mappings while preserving Japanese',()=>{
 expect(isSelectiveReading({text:'LLMの説明',parts:[{text:'LLM',reading:'LLM'},{text:'の説明',reading:'の説明'}]})).toBe(false);
 expect(isSelectiveReading({text:'LLMの説明',parts:[{text:'LLM',reading:'エルエルエム'},{text:'の説明',reading:'ノセツメイ'}]})).toBe(false);
 expect(pronunciationSpans('漢字は123のまま。')).toEqual([{text:'漢字は123のまま。',latin:false}]);
});
