import {expect,it,vi} from "vitest";
import {eraseDuration,erasePlan,paintBoardErase,eraserPoint,eraserWorldPoint,boardEraseArea} from "./board-erase.ts";
it("clears horizontal sweeps, retaining old pixels until contact",()=>{
 const fillRect=vi.fn(),drawImage=vi.fn();
 const output={getContext:()=>({fillRect,drawImage,fillStyle:""})} as unknown as HTMLCanvasElement;
 const source={} as HTMLCanvasElement,area={left:250,top:160,right:1030,bottom:550};
 paintBoardErase(output,source,0);expect(drawImage).toHaveBeenCalledWith(source,0,0);expect(fillRect).not.toHaveBeenCalled();
 paintBoardErase(output,source,.3,"green",area);
 expect(fillRect).toHaveBeenCalledTimes(1);
 expect(fillRect.mock.calls[0]![2]).toBeGreaterThan(100);expect(fillRect.mock.calls[0]![3]).toBeLessThanOrEqual(94);
 fillRect.mockClear();paintBoardErase(output,source,eraseDuration,"green",area);
 // Every ink pixel is covered; no blanket clear outside the actual swept rows.
 for(let x=area.left;x<area.right;x+=10)for(let y=area.top;y<area.bottom;y+=10)
  expect(fillRect.mock.calls.some(([l,t,w,h])=>x>=l && x<=l+w && y>=t && y<=t+h)).toBe(true);
});
it("sweeps a wide horizontal reach and advances rows continuously",()=>{
 const area={left:250,top:160,right:1030,bottom:550},plan=erasePlan(area);
 const start=eraserPoint(0,area),end=eraserPoint(plan.strokeSeconds*.8,area);
 expect(Math.abs(end.x-start.x)).toBeGreaterThan(450);expect(end.y).toBe(start.y);
 expect(eraserWorldPoint(0).z).toBe(-.16);
 for(let t=1/120;t<eraseDuration;t+=1/120){
  const a=eraserPoint(t-1/120,area),b=eraserPoint(t,area);
  if(a.panel!==b.panel)continue;
  expect(Math.hypot(b.x-a.x,b.y-a.y)).toBeLessThan(35);
 }
 expect(plan.panels).toBe(2);expect(eraseDuration).toBeLessThan(7);
});
it("keeps all strokes within previous ink bounds",()=>{
 const area=boardEraseArea([{x:300,y:200,width:600,height:250,text:"notes",formula:false,line:0}]);
 for(let t=0;t<eraseDuration;t+=.1){const p=eraserPoint(t,area);expect(p.x).toBeGreaterThanOrEqual(area.left);expect(p.x).toBeLessThanOrEqual(area.right);expect(p.y).toBeGreaterThanOrEqual(area.top);expect(p.y).toBeLessThanOrEqual(area.bottom);}
});
