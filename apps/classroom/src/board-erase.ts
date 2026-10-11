import type { BoardMark } from "./board-reveal.ts";
export interface EraseArea {left:number;top:number;right:number;bottom:number}
const wholeBoard:EraseArea={left:0,top:0,right:1280,bottom:720};
export function boardEraseArea(marks:BoardMark[]):EraseArea {
 if(!marks.length)return wholeBoard;
 return {left:Math.max(0,Math.min(...marks.map(m=>m.x))-4),top:Math.max(0,Math.min(...marks.map(m=>m.y))-4),right:Math.min(1280,Math.max(...marks.map(m=>m.x+m.width))+4),bottom:Math.min(720,Math.max(...marks.map(m=>m.y+m.height))+4)};
}
/** Horizontal serpentine strokes. The upright felt covers 42 × 94 board pixels. */
export const eraseDuration=6.8;
export const eraserWidth=42,eraserHeight=94;
export function erasePlan(area:EraseArea=wholeBoard){
 const panels=Math.max(1,Math.ceil((area.right-area.left)/400));
 const rows=Math.max(1,Math.ceil((area.bottom-area.top)/eraserHeight));
 return {panels,rows,width:(area.right-area.left)/panels,height:(area.bottom-area.top)/rows,strokeSeconds:eraseDuration/(panels*rows)};
}
export function eraserPoint(elapsed:number,area:EraseArea=wholeBoard){
 const plan=erasePlan(area);
 const t=Math.max(0,Math.min(eraseDuration-.000001,elapsed))/plan.strokeSeconds;
 const stroke=Math.floor(t),panel=Math.floor(stroke/plan.rows),row=stroke%plan.rows;
 const left=area.right-(panel+1)*plan.width,right=left+plan.width;
 const p=Math.min(1,(t-stroke)/.8),ease=p*p*(3-2*p);
 const inset=Math.min(eraserWidth/2,plan.width/2);
 const start=row%2?left+inset:right-inset,end=row%2?right-inset:left+inset;
 const advance=Math.max(0,(t-stroke-.8)/.2),down=advance*advance*(3-2*advance);
 const y=area.top+(row+.5)*plan.height+(row<plan.rows-1?down*plan.height:0);
 return {x:start+(end-start)*ease,y,panel,row,stroke};
}
export function paintBoardErase(output:HTMLCanvasElement,source:HTMLCanvasElement,elapsed:number,background="#204a3d",area:EraseArea=wholeBoard){
 const ctx=output.getContext("2d");if(!ctx)return;
 ctx.drawImage(source,0,0);ctx.fillStyle=background;
 if(elapsed<=0)return;
 const plan=erasePlan(area),point=eraserPoint(elapsed,area);
 for(let stroke=0;stroke<=point.stroke;stroke++){
  const panel=Math.floor(stroke/plan.rows),row=stroke%plan.rows;
  const left=area.right-(panel+1)*plan.width,right=left+plan.width;
  const top=Math.max(area.top,area.top+(row+.5)*plan.height-eraserHeight/2);
  const bottom=Math.min(area.bottom,area.top+(row+.5)*plan.height+eraserHeight/2);
  const complete=elapsed>=eraseDuration || stroke<point.stroke;
  const x=complete||row%2?left:Math.max(left,point.x-eraserWidth/2);
  const end=complete||!(row%2)?right:Math.min(right,point.x+eraserWidth/2);
  ctx.fillRect(x,top,end-x,bottom-top);
 }
}
export function eraserWorldPoint(elapsed:number,area:EraseArea=wholeBoard){
 const p=eraserPoint(elapsed,area);
 return {x:-3.7865+p.x/1280*4.633,y:3.3038-p.y/720*2.6076,z:-.16};
}
export function eraserStandingX(elapsed:number,area:EraseArea=wholeBoard){
 const plan=erasePlan(area),panel=eraserPoint(elapsed,area).panel;
 return -3.7865+(area.right-(panel+.5)*plan.width)/1280*4.633+.2;
}
