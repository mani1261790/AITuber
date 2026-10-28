/** Only infer locations from text actually present on the PDF, never a guessed box. */
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
export function matchingSlideText(label:string,text:string){
 const candidates=[label,label.split("の")[0]??"",label.replace(/(?:手段|クライアント)$/u,""),...(label.match(/[A-Za-z][A-Za-z_]{2,}/g)??[])];
 return candidates.some(candidate=>{const key=normalize(candidate);return (key.length>=3||/^[\p{Script=Han}]{2,}$/u.test(key))&&normalize(text).includes(key);});
}
export function spokenSlideTarget(text:string,targets:readonly {id:string;label:string;visible:boolean}[],regions:readonly {id:string;text?:string}[]){
 const located = targets.filter(t=>t.visible&&regions.some(r=>r.id===t.id)&&matchingSlideText(t.label,text)).sort((a,b)=>b.label.length-a.label.length)[0]?.id;
 if(located) return located;
 const speech=normalize(text);
 const candidates=regions.filter(r=>r.text).map(region=>({region,score:spokenTextScore(speech,region.text!)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 return candidates[0]?.region.id??null;
}
export function inferredPdfRegion(label:string,items:readonly {text:string;x:number;y:number;width:number;height:number}[],width:number,height:number){
 const matches=items.filter(item=>matchingSlideText(label,item.text));
 // Repeated text is ambiguous; only an unambiguous, horizontal text box is usable.
 if(matches.length!==1)return null;
 const item=matches[0]!;
 if(item.width<=0||item.height<=0||item.x<0||item.y<0||item.x+item.width>width||item.y+item.height>height)return null;
 return {x:item.x/width,y:item.y/height,width:item.width/width,height:item.height/height};
}

const segmenter = new Intl.Segmenter("ja", {granularity:"word"});
const genericWords = new Set(["ここ","これ","それ","ため","こと","もの","よう","今回","次","説明","利用","使用","方法","場合","必要","確認","できる","する","します","ます","です","the","and","this","that","with"]);
function spokenTextScore(speech:string, text:string):number {
 const terms=[...segmenter.segment(text)].filter(part=>part.isWordLike).map(part=>normalize(part.segment)).filter(term=>!genericWords.has(term)&&(/^[\p{Script=Han}]{2,}$/u.test(term)||/^[\p{Script=Katakana}ー]{3,}$/u.test(term)||/^[a-z][a-z0-9_]{2,}$/u.test(term)));
 const hits=[...new Set(terms)].filter(term=>speech.includes(term));
 return hits.reduce((score,term)=>score+term.length,0);
}
export function pdfTextRegions(items:readonly {text:string;x:number;y:number;width:number;height:number}[],width:number,height:number) {
 const lines: {text:string;x:number;y:number;width:number;height:number}[]=[];
 for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)) {
  if(!item.text.trim() || item.width<=0 || item.height<=0 || item.x<0 || item.y<0 || item.x+item.width>width || item.y+item.height>height) continue;
  // PDF text runs often split a single command into separate font/word boxes.
  // Join only adjacent runs on the same baseline; never span distant columns.
  const line=lines.findLast(line=>Math.abs((line.y+line.height)-(item.y+item.height))<Math.min(line.height,item.height)*.3 && item.x>=line.x+line.width-1 && item.x-(line.x+line.width)<Math.max(line.height,item.height)*1.5);
  if(line){line.text+=" "+item.text;line.width=item.x+item.width-line.x;const bottom=Math.max(line.y+line.height,item.y+item.height);line.y=Math.min(line.y,item.y);line.height=bottom-line.y;}
  else lines.push({...item});
 }
 return lines.map((item,index)=>({id:`pdf-text:${index}`,text:item.text,x:item.x/width,y:item.y/height,width:item.width/width,height:item.height/height}));
}
