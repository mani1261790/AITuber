/** Only infer locations from text actually present on the PDF, never a guessed box. */
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
export function matchingSlideText(label:string,text:string){
 const candidates=[label,label.split("の")[0]??"",label.replace(/(?:手段|クライアント)$/u,""),...(label.match(/[A-Za-z][A-Za-z_]{2,}/g)??[])];
 return candidates.some(candidate=>{const key=normalize(candidate);return (key.length>=3||/^[\p{Script=Han}]{2,}$/u.test(key))&&normalize(text).includes(key);});
}
export function spokenSlideTarget(text:string,targets:readonly {id:string;label:string;visible:boolean}[],regions:readonly {id:string}[]){
 return targets.filter(t=>t.visible&&regions.some(r=>r.id===t.id)&&matchingSlideText(t.label,text)).sort((a,b)=>b.label.length-a.label.length)[0]?.id??null;
}
export function inferredPdfRegion(label:string,items:readonly {text:string;x:number;y:number;width:number;height:number}[],width:number,height:number){
 const matches=items.filter(item=>matchingSlideText(label,item.text));
 // Repeated text is ambiguous; only an unambiguous, horizontal text box is usable.
 if(matches.length!==1)return null;
 const item=matches[0]!;
 if(item.width<=0||item.height<=0||item.x<0||item.y<0||item.x+item.width>width||item.y+item.height>height)return null;
 return {x:item.x/width,y:item.y/height,width:item.width/width,height:item.height/height};
}
