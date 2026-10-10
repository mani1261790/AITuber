import {expect,it} from "vitest";
import {markdownBoard} from "./blackboard-markdown.ts";
it("keeps Japanese notation and TeX intact, with stable content ids",()=>{
 const text="# 平方完成\n◎ **頂点**\n$$y=(x-2)^2-1$$\n→ 頂点は $(2,-1)$";
 expect(markdownBoard(text)).toMatchObject({markdown:text,purpose:"平方完成"});
 expect(markdownBoard(text)?.id).toBe(markdownBoard(text)?.id);
 expect(markdownBoard(null)).toBeUndefined();
});
it("rejects oversized notes and active markup rather than silently clipping the board",()=>{
 for(const text of ["a".repeat(81),Array(9).fill("行").join("\n"),"<img src=x>","![図](https://example.com)"])
  expect(()=>markdownBoard(text)).toThrow();
});
