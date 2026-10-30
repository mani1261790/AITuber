import {afterEach, expect, it, vi} from "vitest";
import type {StageScene} from "@aituber/presentation";
vi.mock("pdfjs-dist", () => ({GlobalWorkerOptions:{}, getDocument:({data}:{data:Uint8Array}) => {
  expect(data.byteLength).toBe(3);
  structuredClone(data, {transfer:[data.buffer]});
  return {promise:Promise.resolve({getPage:async()=>({
    getViewport:()=>({width:1280,height:720}),
    render:()=>({promise:Promise.resolve()}),getTextContent:async()=>({items:[]})
  })}),destroy:async()=>{}};
}}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function setup(){
  const fetcher=vi.fn(async()=>new Response(new Uint8Array([1,2,3])));
  vi.stubGlobal("fetch",fetcher);
  vi.stubGlobal("document",{createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}})})});
  return fetcher;
}
const scene=(pageNumber:number)=>({slide:{sourceId:"pdf",pageNumber},targets:[]}) as unknown as StageScene;
it("reuses original PDF bytes across pages without transferring the cached buffer",async()=>{
 const fetcher=setup();const {renderPdfSlide}=await import("./pdf-slide.ts");const access={code:"one",accessToken:"secret"};
 const a=await renderPdfSlide(scene(1),access,new AbortController().signal);
 await renderPdfSlide(scene(2),access,new AbortController().signal);
 expect(await renderPdfSlide(scene(1),access,new AbortController().signal)).toBe(a);
 expect(fetcher).toHaveBeenCalledTimes(1);
 await renderPdfSlide(scene(1),{...access,accessToken:"other"},new AbortController().signal);
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it("a superseded scene does not cancel a shared prefetch",async()=>{
 const fetcher=setup();const {renderPdfSlide}=await import("./pdf-slide.ts");const access={code:"two",accessToken:"secret"};
 const controller=new AbortController();const first=renderPdfSlide(scene(1),access,controller.signal);
 controller.abort();const second=renderPdfSlide(scene(1),access,new AbortController().signal);
 await expect(first).rejects.toThrow();await expect(second).resolves.toHaveProperty("canvas");
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retries a failed source instead of caching its rejection",async()=>{
 const fetcher=setup();fetcher.mockResolvedValueOnce(new Response("",{status:503}));
 const {renderPdfSlide}=await import("./pdf-slide.ts");const access={code:"three",accessToken:"secret"};
 await expect(renderPdfSlide(scene(1),access,new AbortController().signal)).rejects.toThrow("503");
 await expect(renderPdfSlide(scene(1),access,new AbortController().signal)).resolves.toHaveProperty("canvas");
 expect(fetcher).toHaveBeenCalledTimes(2);
});
