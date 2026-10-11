import type { BoardMark } from "./board-reveal.ts";
export interface EraseArea {left:number;top:number;right:number;bottom:number}
const wholeBoard:EraseArea={left:0,top:0,right:1280,bottom:720};
export function boardEraseArea(marks:BoardMark[]):EraseArea {
 if(!marks.length)return wholeBoard;
 return {left:Math.max(0,Math.min(...marks.map(m=>m.x))-4),top:Math.max(0,Math.min(...marks.map(m=>m.y))-4),right:Math.min(1280,Math.max(...marks.map(m=>m.x+m.width))+4),bottom:Math.min(720,Math.max(...marks.map(m=>m.y+m.height))+4)};
}
/** Shared pixel-space path for both the eraser prop and the board texture. */
export const eraseStrokeSeconds=1.7;
export const eraseColumns=12;
export const eraseDuration=eraseColumns*eraseStrokeSeconds;
export function eraserPoint(elapsed:number,area:EraseArea=wholeBoard){
 const t=Math.max(0,Math.min(eraseDuration-.000001,elapsed));
 const column=Math.floor(t/eraseStrokeSeconds);
 const p=Math.min(1,(t%eraseStrokeSeconds)/1.1);
 const eased=p*p*(3-2*p);
 const travel=Math.max(0,Math.min(1,((t%eraseStrokeSeconds)-1.1)/.6));
 const next=column%3===2?0:travel*travel*(3-2*travel);
 const top=Math.min(area.bottom,area.top+45),bottom=Math.max(top,area.bottom-45);
 return {x:area.left+(column+.5+next)*(area.right-area.left)/eraseColumns,y:column%2?bottom-(bottom-top)*eased:top+(bottom-top)*eased,column};
}
export function paintBoardErase(output:HTMLCanvasElement,source:HTMLCanvasElement,elapsed:number,background="#204a3d",area:EraseArea=wholeBoard){
 const ctx=output.getContext("2d");if(!ctx)return;
 ctx.drawImage(source,0,0);ctx.fillStyle=background;
 const point=eraserPoint(elapsed,area),width=(area.right-area.left)/eraseColumns;
 // Only the area swept by the felt disappears. No whole-board fade or swap.
 for(let column=0;column<=point.column;column++){
  const complete=elapsed>=eraseDuration || column<point.column;
  const y=complete?area.top:column%2?point.y-45:area.top;
  const height=complete?area.bottom-area.top:column%2?area.bottom-y:point.y+45-area.top;
  if(elapsed>0)ctx.fillRect(area.left+column*width,y,width+.5,height);
 }
}

export function eraserWorldPoint(elapsed:number,area:EraseArea=wholeBoard){
 const p=eraserPoint(elapsed,area);
 return {x:-3.7865+p.x/1280*4.633,y:3.3038-p.y/720*2.6076,z:-.16};
}
export function eraserStandingX(elapsed:number,area:EraseArea=wholeBoard){
 const group=Math.floor(eraserPoint(elapsed).column/3);
 return -3.7865+(area.left+(group*3+1.5)/12*(area.right-area.left))/1280*4.633+.2;
}
