import {describe,expect,it,vi} from "vitest";
import {fitOmniSvg,OmniSvgProvider} from "./omnisvg.ts";
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" height="200px" width="200px"><path fill="#ffee99" d="M10 10 L190 190 Z"/></svg>';
describe("OmniSVG local integration",()=>{
  it("contains the entire specialist drawing without rewriting paths",()=>{
    const fitted=fitOmniSvg(svg);
    expect(fitted).toContain('viewBox="0 0 1600 900"');
    expect(fitted).toContain('translate(430 80) scale(3.7)');
    expect(fitted).toContain('d="M10 10 L190 190 Z"');
    expect(fitted).not.toContain('<text');
  });
  it("does not weaken SVG validation during normalization",()=>{
    expect(()=>fitOmniSvg(svg.replace('<path','<script/><path'))).toThrow();
    expect(()=>fitOmniSvg(svg.replace('0 0 200 200','0 0 0 200'))).toThrow();
    expect(()=>fitOmniSvg('<!DOCTYPE svg>'+svg)).toThrow();
    expect(()=>fitOmniSvg(svg.replace('fill="#ffee99"','fill="url(https://example.com)"'))).toThrow();
  });
  it("sends Japanese requirements to a local service, never a paid fallback",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({svg})));
    const provider=new OmniSvgProvider({fetch:fetcher});
    const call={name:"draw_blackboard" as const,arguments:{purpose:"平方完成",requirements:"頂点という文字と数式も含める",mode:"replace" as const}};
    await expect(provider.generate(call,new AbortController().signal)).resolves.toContain('<path');
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4314/v1/svg");
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain("頂点");
    await expect(provider.generate({...call,arguments:{...call.arguments,mode:"append"}},new AbortController().signal)).rejects.toThrow("replacement");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects remote endpoints and respects cancellation",async()=>{
    expect(()=>new OmniSvgProvider({endpoint:"https://example.com"})).toThrow("local HTTP");
    const controller=new AbortController();controller.abort();const fetcher=vi.fn<typeof fetch>();
    await expect(new OmniSvgProvider({fetch:fetcher}).generate({name:"draw_blackboard",arguments:{purpose:"図",requirements:"力",mode:"replace"}},controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
