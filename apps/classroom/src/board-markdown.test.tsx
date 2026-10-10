import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {BoardMarkdown} from "./board-markdown.tsx";
it("renders headings, emphasis, Japanese board marks and TeX without executing HTML",()=>{
 const html=renderToStaticMarkup(<BoardMarkdown id="board.test" text={'# 平方完成\n◎ **頂点** → $(2,-1)$\n$$y=(x-2)^2-1$$\n<script>alert(1)</script>'}/>);
 expect(html).toContain("<h3>");expect(html).toContain("<strong>");expect(html).toContain("◎");expect(html).toContain("→");
 expect(html).toContain('data-formula-state="rendered"');expect(html).not.toContain('data-formula-state="invalid"');
 expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");
});
