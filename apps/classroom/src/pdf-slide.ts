import {inferredPdfRegion} from "./slide-pointing.ts";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfSlideLayout, projectedPdfRegion } from "./pdf-slide-layout.ts";
import type { StageScene } from "@aituber/presentation";
export interface SlideAccess { code: string; accessToken: string }
export async function renderPdfSlide(scene: StageScene, access: SlideAccess, signal: AbortSignal) {
  if (!scene.slide) throw new Error("Missing slide reference");
  const response = await fetch(`/api/classrooms/${encodeURIComponent(access.code)}/source`, {
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({accessToken:access.accessToken,sourceId:scene.slide.sourceId}),signal,
  });
  if (!response.ok) throw new Error(`PDF取得失敗 (${response.status})`);
  const data=new Uint8Array(await response.arrayBuffer());
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
    return {canvas,regions};
  } finally {signal.removeEventListener("abort",abort);await task.destroy();}
}
