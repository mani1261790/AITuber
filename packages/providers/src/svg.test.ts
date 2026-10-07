import { describe, expect, it, vi } from "vitest";
import { QuiverSvgProvider, validateBlackboardSvg, type BlackboardToolCall } from "./svg.ts";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><text x="100" y="200" fill="white" font-size="64">頂点 (2, −1)</text></svg>';
const call: BlackboardToolCall = {name:"draw_blackboard",arguments:{purpose:"頂点",requirements:"日本語と数式",mode:"replace"}};
describe("dedicated SVG provider",()=>{
  it("preserves generated Japanese, coordinates and equations",()=>{ expect(validateBlackboardSvg(svg)).toContain('x="100" y="200"'); expect(validateBlackboardSvg(svg)).toContain("頂点 (2, −1)"); });
  it.each(['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.com"/>','<g onclick="alert(1)"/>','<path fill="url(https://example.com)"/>','<style>text{fill:red}</style>','<text font-size="12">小さい</text>'])('rejects unsafe or unreadable markup %s',content=>{expect(()=>validateBlackboardSvg(svg.replace(/<text.*<\/text>/,content))).toThrow();});
  it("rejects entities, malformed markup and wrong dimensions",()=>{
    expect(()=>validateBlackboardSvg('<!DOCTYPE svg>'+svg)).toThrow();
    expect(()=>validateBlackboardSvg(svg.replace('</text>',''))).toThrow();
    expect(()=>validateBlackboardSvg(svg.replace('1600 900','100 100'))).toThrow();
  });
  it("calls the real Quiver wire contract and returns only validated SVG",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({data:[{svg,mime_type:"image/svg+xml"}]})));
    const provider=new QuiverSvgProvider({apiKey:"test",fetch:fetcher});
    await expect(provider.generate(call,new AbortController().signal)).resolves.toContain("頂点");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.quiver.ai/v1/svgs/generations");
    const body=JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe("arrow-2"); expect(body.instructions).toContain("ALL Japanese");
    await expect(provider.generate({...call,arguments:{...call.arguments,mode:"append"}},new AbortController().signal)).rejects.toThrow("No previous");
  });
  it("does not submit aborted or unconfigured requests",async()=>{
    const fetcher=vi.fn<typeof fetch>(); const controller=new AbortController(); controller.abort();
    await expect(new QuiverSvgProvider({apiKey:"test",fetch:fetcher}).generate(call,controller.signal)).rejects.toThrow();
    await expect(new QuiverSvgProvider({apiKey:"",fetch:fetcher}).generate(call,new AbortController().signal)).rejects.toThrow("not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
