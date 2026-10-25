/** Only Latin words/phrases are pronunciation overrides. Japanese remains original. */
export const hasLatin=(text:string)=>/[\p{Script=Latin}]/u.test(text.normalize('NFKC'));
export const isLatinSpan=(text:string)=>/^[\p{Script=Latin}\p{M} '\u2019\u2010\u2011-]+$/u.test(text.normalize('NFKC'))&&hasLatin(text);
export const toKatakana=(text:string)=>text.normalize('NFKC').replace(/[ぁ-ゖ]/g,char=>String.fromCharCode(char.charCodeAt(0)+0x60));
export const isKatakanaReading=(text:string)=>/^[\p{Script=Katakana}ー・\s、。！？]+$/u.test(text)&&/[\p{Script=Katakana}]/u.test(text);
export function pronunciationSpans(text:string){
 const result:{text:string;latin:boolean}[]=[];
 const append=(value:string,latin:boolean)=>{let chunk='';for(const char of value){if(chunk.length+char.length>40){result.push({text:chunk,latin});chunk='';}chunk+=char;}if(chunk)result.push({text:chunk,latin});};
 const chars=[...text];let run='',latin=false;
 const letter=(char:string)=>hasLatin(char)||/^[\p{M}]+$/u.test(char);
 const flush=()=>{if(run)append(run,latin);run='';};
 for(let index=0;index<chars.length;index++){
  const char=chars[index]!;
  const nextLatin:boolean=letter(char)||(latin&&/^[ '\u2019\u2010\u2011-]$/u.test(char)&&letter(chars[index+1]??''));
  if(nextLatin!==latin){flush();latin=nextLatin;}run+=char;
 }
 flush();return result;
}
export function isSelectiveReading(item:{text:string;parts:readonly {text:string;reading:string}[]}){
 return item.parts.length>0&&item.parts.map(part=>part.text).join('')===item.text&&item.parts.every(part=>isLatinSpan(part.text)?isKatakanaReading(part.reading):!hasLatin(part.text)&&part.reading===part.text);
}
