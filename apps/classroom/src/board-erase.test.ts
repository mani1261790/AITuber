import {expect,it,vi} from "vitest";
import {eraseDuration,eraseColumns,eraserColumnsPerStop,paintBoardErase,eraserPoint,eraserWorldPoint} from "./board-erase.ts";
it("retains old pixels before contact and progressively clears swept strips",()=>{
 const fillRect=vi.fn(),drawImage=vi.fn();
 const output={getContext:()=>({fillRect,drawImage,fillStyle:""})} as unknown as HTMLCanvasElement;
 const source={} as HTMLCanvasElement;
 paintBoardErase(output,source,0);expect(drawImage).toHaveBeenCalledWith(source,0,0);expect(fillRect).not.toHaveBeenCalled();
 paintBoardErase(output,source,.25);expect(fillRect).toHaveBeenCalledTimes(1);
 expect(fillRect.mock.calls[0]![3]).toBeGreaterThan(45);expect(fillRect.mock.calls[0]![3]).toBeLessThan(720);
 fillRect.mockClear();paintBoardErase(output,source,eraseDuration);
 expect(fillRect).toHaveBeenCalledTimes(eraseColumns);
 expect(fillRect.mock.calls.every(call=>call[1]===0 && call[3]===720)).toBe(true);
});
it("uses the scaled board coordinates and continuous hand sweeps within each standing area",()=>{
 expect(eraserWorldPoint(0).z).toBe(-.16);
 for(let t=1/60;t<eraseDuration;t+=1/60){
  const a=eraserPoint(t-1/60),b=eraserPoint(t);
  if(Math.floor(a.column/eraserColumnsPerStop())!==Math.floor(b.column/eraserColumnsPerStop()))continue;
  expect(Math.hypot(b.x-a.x,b.y-a.y)).toBeLessThan(32);
 }
});
it("limits wiping to the previous ink bounds instead of unused board space",async()=>{
 const {boardEraseArea}=await import("./board-erase.ts");
 const area=boardEraseArea([{x:300,y:200,width:600,height:250,text:"notes",formula:false,line:0}]);
 for(let t=0;t<eraseDuration;t+=.1){const p=eraserPoint(t,area);expect(p.x).toBeGreaterThanOrEqual(area.left);expect(p.x).toBeLessThanOrEqual(area.right);expect(p.y).toBeGreaterThanOrEqual(area.top);expect(p.y).toBeLessThanOrEqual(area.bottom);}
});

it("uses two stops for ordinary notes and caps active wiping below seven seconds",()=>{
 const area={left:250,top:160,right:1030,bottom:550};
 expect(eraseDuration).toBeLessThan(7);
 expect(eraseColumns/eraserColumnsPerStop(area)).toBe(2);
});
