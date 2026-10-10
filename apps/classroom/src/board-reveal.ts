/** Rasterized once; reveal glyph rectangles without re-typesetting partial TeX. */
export interface BoardMark { x:number; y:number; width:number; height:number; text:string; formula:boolean; line:number }
export interface BoardReveal { marks:(BoardMark & {start:number;end:number})[]; duration:number; background:string }
export function planBoardReveal(marks:BoardMark[],background="#204a3d"):BoardReveal {
 let time=0,line=-1;
 const timed=marks.map(mark=>{
  if(mark.line!==line){if(line!==-1)time+=.35;line=mark.line;}
  const start=time;
  time+=mark.formula?Math.min(3,Math.max(.8,mark.text.length*.055)):/^\s+$/.test(mark.text)?.045:.15;
  return {...mark,start,end:time};
 });
 const scale=time>30?30/time:1;
 return {marks:timed.map(mark=>({...mark,start:mark.start*scale,end:mark.end*scale})),duration:time*scale+.45,background};
}
export function measureBoardReveal(root:HTMLElement):BoardReveal|undefined {
 const content=root.querySelector<HTMLElement>(".board-markdown");if(!content)return;
 const origin=root.getBoundingClientRect(),marks:BoardMark[]=[];
 const add=(rect:DOMRect,text:string,formula:boolean,line:number)=>{
  if(rect.width && rect.height)marks.push({x:rect.left-origin.left-1,y:rect.top-origin.top-2,width:rect.width+2,height:rect.height+4,text,formula,line});
 };
 [...content.children].forEach((line,index)=>{
  const visit=(node:Node)=>{
   if(node instanceof HTMLElement && node.classList.contains("formula")){add(node.getBoundingClientRect(),node.textContent??"",true,index);return;}
   if(node.nodeType===Node.TEXT_NODE){
    const text=node.textContent??"",segments=new Intl.Segmenter("ja",{granularity:"grapheme"}).segment(text);
    for(const part of segments){const range=document.createRange();range.setStart(node,part.index);range.setEnd(node,part.index+part.segment.length);add(range.getBoundingClientRect(),part.segment,false,index);}
   }else for(const child of node.childNodes)visit(child);
  };visit(line);
 });
 return planBoardReveal(marks,getComputedStyle(root).backgroundColor);
}
export function paintBoardReveal(output:HTMLCanvasElement,source:HTMLCanvasElement,plan:BoardReveal,elapsed:number){
 const ctx=output.getContext("2d");if(!ctx)return;
 ctx.fillStyle=plan.background;ctx.fillRect(0,0,output.width,output.height);
 if(elapsed>=plan.duration){ctx.drawImage(source,0,0);return;}
 for(const mark of plan.marks){
  if(elapsed<mark.end)continue;
  // Mathematical expressions appear intact, after their writing time has elapsed.
  ctx.save();ctx.beginPath();ctx.rect(mark.x,mark.y,mark.width,mark.height);ctx.clip();ctx.drawImage(source,0,0);ctx.restore();
 }
}
