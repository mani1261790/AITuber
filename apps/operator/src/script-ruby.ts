import {isLatinSpan,hasLatin,toKatakana,pronunciationSpans,isSelectiveReading} from '@aituber/contracts';
import type {CoursePackage} from '@aituber/contracts';
type Reading=NonNullable<CoursePackage['performance']>['readings'][number];
export interface RubyPart {text:string;reading?:string}
const escape=(value:string)=>value.replace(/[\\｜《》]/g,'\\$&');
/** Explicit base marker avoids guessing Japanese word boundaries; backslash escapes literals. */
export function formatRuby(text:string,reading?:Reading,preferences:CoursePackage['pronunciationDictionary']=[]){
 if(reading&&isSelectiveReading(reading))return reading.parts.map(part=>isLatinSpan(part.text)?`｜${escape(part.text)}《${escape(part.reading)}》`:escape(part.text)).join('');
 const sorted=[...preferences].filter(item=>isLatinSpan(item.surface)).sort((a,b)=>b.surface.length-a.surface.length);let result='',offset=0;
 while(offset<text.length){const match=sorted.find(item=>text.startsWith(item.surface,offset));if(match){result+=`｜${escape(match.surface)}《${escape(match.reading)}》`;offset+=match.surface.length;}else result+=escape(text[offset++]!);}
 return result;
}
export function parseRuby(value:string):RubyPart[]{
 const parts:RubyPart[]=[];let plain='',index=0;
 const take=(end:string)=>{let result='';while(index<value.length){const c=value[index++]!;if(c==='\\'){if(index<value.length&&'\\｜《》'.includes(value[index]!))result+=value[index++]!;else result+='\\';}else if(c===end)return result;else if('｜《》'.includes(c))throw Error('ルビは ｜原文《よみ》 の形で記述してください');else result+=c;}throw Error('ルビの括弧が閉じていません');};
 while(index<value.length){const c=value[index++]!;if(c==='\\'){if(index<value.length&&'\\｜《》'.includes(value[index]!))plain+=value[index++]!;else plain+='\\';}else if(c==='｜'){
  if(plain){parts.push({text:plain});plain='';}const text=take('《'),reading=take('》');if(!isLatinSpan(text))throw Error('ルビは英字の語句にだけ付けてください');if(!text||!reading.trim())throw Error('ルビの原文と読みを入力してください');if(/[\p{Script=Han}A-Za-z0-9<>]/u.test(reading))throw Error('読みはかなで入力してください');if(text.length>40||reading.length>160)throw Error('ルビは短い語句ごとに分けてください');parts.push({text,reading:toKatakana(reading)});
 }else if('《》'.includes(c))throw Error('ルビの前に ｜ を付けてください');else plain+=c;}
 if(plain)parts.push({text:plain});return parts;
}
export function applyRuby(course:Pick<CoursePackage,'performance'|'pronunciationDictionary'>,unitId:string,index:number,value:string){
 const beat=course.performance?.units.find(unit=>unit.unitId===unitId)?.beats[index];if(!beat)throw Error('編集対象の台本がありません');
 const parts=parseRuby(value),text=parts.map(part=>part.text).join('');if(!text.trim()||text.length>600)throw Error('話す内容は1〜600文字で入力してください');
 const old=course.performance!.readings.find(item=>item.text===beat.text);
 for(const part of parts){if(!part.reading||old?.parts.some(prior=>prior.text===part.text&&prior.reading===part.reading))continue;
  const preference=course.pronunciationDictionary.find(item=>item.surface===part.text);if(preference)preference.reading=part.reading;else course.pronunciationDictionary.push({surface:part.text,reading:part.reading});
 }
 beat.text=text;
 // Keep unrelated/shared utterances; only replace the exact new text mapping.
 course.performance!.readings=course.performance!.readings.filter(item=>item.text!==text);
 if(parts.every(part=>part.reading!==undefined||!hasLatin(part.text)))course.performance!.readings.push({text,parts:parts.flatMap(part=>part.reading?[{text:part.text,reading:part.reading}]:pronunciationSpans(part.text).map(span=>({text:span.text,reading:span.text})))});
}
