import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {BoardMarkdown} from "./board-markdown.tsx";
it("renders headings, emphasis, Japanese board marks and TeX without executing HTML",()=>{
 const html=renderToStaticMarkup(<BoardMarkdown id="board.test" text={'# 平方完成\n◎ **頂点** → $(2,-1)$\n$$y=(x-2)^2-1$$\n<script>alert(1)</script>'}/>);
 expect(html).toContain('<h3 class="board-row">');expect(html).toContain("<strong>");expect(html).toContain("◎");expect(html).toContain("→");
 expect(html).toContain('data-formula-state="rendered"');expect(html).not.toContain('data-formula-state="invalid"');
 expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");
});
it("distinguishes centered equations, indented explanations and paragraph spacing",()=>{
 const html=renderToStaticMarkup(<BoardMarkdown id="board.layout" text={'# 題\n$$Av=\\lambda v$$\n  固有ベクトル\n    基底を選ぶ\n\n→ 結論'}/>);
 expect(html).toContain('board-row--formula');expect(html).toContain('data-indent="1"');expect(html).toContain('data-indent="2"');expect(html).toContain('board-row--separated');
});
it("centers short and oversized notes inside the board safe area",async()=>{
 const {boardLayout}=await import("./board-markdown.tsx");
 for(const [width,height] of [[760,300],[1400,800],[1120,560]]){
  const layout=boardLayout(width!,height!);
  expect(layout.left).toBeGreaterThanOrEqual(80);expect(layout.top).toBeGreaterThanOrEqual(80);
  expect(layout.left*2+width!*layout.scale).toBeCloseTo(1280);
  expect(layout.top*2+height!*layout.scale).toBeCloseTo(720);
 }
});
it("renders the university example with its matrix and diagonalization formula",async()=>{
 const {boardExamples}=await import("@aituber/contracts");
 const example=boardExamples.find(example=>example.title==="大学数学")!;
 const html=renderToStaticMarkup(<BoardMarkdown id="board.university" text={example.blackboardMarkdown}/>);
 expect(html).toContain("固有値と対角化");expect(html).not.toContain('data-formula-state="invalid"');expect(html.match(/data-formula-state="rendered"/g)?.length).toBe(6);
});
