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

it("uses the same valid few-shot examples as the classroom preview",async()=>{
 const {boardExamples}=await import("@aituber/contracts");
 const {boardMarkdownInstruction}=await import("./blackboard-markdown.ts");
 for(const example of boardExamples){expect(markdownBoard(example.blackboardMarkdown)).toBeDefined();expect(boardMarkdownInstruction).toContain(JSON.stringify(example.blackboardMarkdown));}
});

it("rejects ambiguous message chains without rejecting explicit return paths or math",()=>{
 expect(()=>markdownBoard("# Web検索の往復\nアプリ → LLM：結果を渡す → 利用者：回答")).toThrow("1行に1つ");
 expect(()=>markdownBoard("アプリ → LLM:結果 → 利用者:回答")).toThrow("1行に1つ");
 const explicit="# Web検索の往復\nLLM → アプリ：検索依頼\nアプリ → 検索ツール：検索実行\n検索ツール → アプリ：検索結果\nアプリ → LLM：結果\nLLM → アプリ：回答\nアプリ → 利用者：回答";
 expect(markdownBoard(explicit)?.markdown).toBe(explicit);
 for(const valid of ["LLM → アプリ → 利用者", "役割：LLM → アプリ → ツール", "$x-h=0$ → $x=h$", "$f:A\\to B$ → $g:B\\to C$"])
  expect(markdownBoard(valid)).toBeDefined();
});
