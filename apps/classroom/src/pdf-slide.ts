import {inferredPdfRegion,pdfTextRegions} from "./slide-pointing.ts";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfSlideLayout, projectedPdfRegion } from "./pdf-slide-layout.ts";
import type { StageScene } from "@aituber/presentation";
export interface SlideAccess { code: string; accessToken: string }
// Keep only a few pages and sources; a shared fetch must survive the old scene's abort.
const sources = new Map<string, Promise<Uint8Array>>();
const pages = new Map<string, ReturnType<typeof renderPage>>();
function remember<T>(cache: Map<string, Promise<T>>, key: string, limit: number, create: () => Promise<T>) {
  const found = cache.get(key);
  if (found) { cache.delete(key); cache.set(key, found); return found; }
  const pending = create(); cache.set(key, pending);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
  void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  return pending;
}
export async function renderPdfSlide(scene: StageScene, access: SlideAccess, signal: AbortSignal) {
  signal.throwIfAborted();
  const key = JSON.stringify([access, scene.slide, scene.targets.map(t => [t.id, t.label, t.visible, t.pageRegion])]);
  const result = await remember(pages, key, 3, () => renderPage(scene, access, AbortSignal.timeout(60000)));
  signal.throwIfAborted();
  return result;
}
async function renderPage(scene: StageScene, access: SlideAccess, signal: AbortSignal) {
  if (!scene.slide) throw new Error("Missing slide reference");
  const sourceId = scene.slide.sourceId;
  const bytes = await remember(sources, JSON.stringify([access, sourceId]), 2, async () => {
    const response = await fetch(`/api/classrooms/${encodeURIComponent(access.code)}/source`, {
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({accessToken:access.accessToken,sourceId}), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`PDF取得失敗 (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  });
  // PDF.js transfers its buffer to the worker, so preserve the cached original.
  const data = bytes.slice();
  signal.throwIfAborted();
  const {getDocument,GlobalWorkerOptions}=await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc=workerUrl;
  const task=getDocument({data,cMapUrl:"/pdfjs/cmaps/",cMapPacked:true,standardFontDataUrl:"/pdfjs/standard_fonts/",wasmUrl:"/pdfjs/wasm/"});
  const abort=()=>{void task.destroy();};
  signal.addEventListener("abort",abort,{once:true});
  try {
    const pdf=await task.promise;
    const page=await pdf.getPage(scene.slide.pageNumber);
    const size=page.getViewport({scale:1}), layout=pdfSlideLayout(size.width,size.height);
    const viewport=page.getViewport({scale:layout.scale*2});
    const pageCanvas=document.createElement("canvas");pageCanvas.width=Math.ceil(viewport.width);pageCanvas.height=Math.ceil(viewport.height);
    await page.render({canvas:pageCanvas,viewport}).promise;
    signal.throwIfAborted();
    const canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle="#fff";ctx.fillRect(0,0,1280,720);
    ctx.drawImage(pageCanvas,layout.x,layout.y,layout.width,layout.height);
    const textContent=await page.getTextContent().catch(()=>{signal.throwIfAborted();return {items:[]};});
    const boxes=textContent.items.flatMap(item=>{
      if(!("str" in item)||Math.abs(item.transform[1]!)>.001||Math.abs(item.transform[2]!)>.001)return [];
      const [x,y]=size.convertToViewportPoint(item.transform[4]!,item.transform[5]!);
      return [{text:item.str,x:x!,y:y!-item.height,width:item.width,height:item.height}];
    });
    const regions=scene.targets.filter(t=>t.visible).flatMap(t=>{
      const region=t.pageRegion??inferredPdfRegion(t.label,boxes,size.width,size.height);
      return region?[{id:t.id,...projectedPdfRegion(layout,region)}]:[];
    });
    return {canvas,regions:[...regions,...pdfTextRegions(boxes,size.width,size.height).map(({id,text,...region})=>({id,text,...projectedPdfRegion(layout,region)}))]};
  } finally {signal.removeEventListener("abort",abort);await task.destroy();}
}
