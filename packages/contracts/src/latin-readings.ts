/** Only Latin words/phrases are pronunciation overrides. Japanese remains original. */
export const hasLatin=(text:string)=>/[A-Za-zＡ-Ｚａ-ｚ]/u.test(text);
export const isLatinSpan=(text:string)=>/^[A-Za-zＡ-Ｚａ-ｚ]+(?:[ '-][A-Za-zＡ-Ｚａ-ｚ]+)*$/u.test(text);
export const toKatakana=(text:string)=>text.normalize('NFKC').replace(/[ぁ-ゖ]/g,char=>String.fromCharCode(char.charCodeAt(0)+0x60));
export const isKatakanaReading=(text:string)=>/^[\p{Script=Katakana}ー・\s、。！？]+$/u.test(text)&&/[\p{Script=Katakana}]/u.test(text);
export function pronunciationSpans(text:string){
 const result:{text:string;latin:boolean}[]=[];let cursor=0;
 const append=(value:string,latin:boolean)=>{let chunk='';for(const char of value){if(chunk.length+char.length>40){result.push({text:chunk,latin});chunk='';}chunk+=char;}if(chunk)result.push({text:chunk,latin});};
 for(const match of text.matchAll(/[A-Za-zＡ-Ｚａ-ｚ]+(?:[ '-][A-Za-zＡ-Ｚａ-ｚ]+)*/gu)){append(text.slice(cursor,match.index),false);append(match[0],true);cursor=match.index!+match[0].length;}
 append(text.slice(cursor),false);return result;
}
export function isSelectiveReading(item:{text:string;parts:readonly {text:string;reading:string}[]}){
 return item.parts.length>0&&item.parts.map(part=>part.text).join('')===item.text&&item.parts.every(part=>isLatinSpan(part.text)?isKatakanaReading(part.reading):!hasLatin(part.text)&&part.reading===part.text);
}
