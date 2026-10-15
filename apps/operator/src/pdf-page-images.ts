import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {AuthoringSourceUpload} from "@aituber/contracts";

/** Rasterize before upload so the same path works on Workers without native canvas. */
export async function pdfPageImages(file: File): Promise<NonNullable<AuthoringSourceUpload["pageImages"]>> {
  const {getDocument,GlobalWorkerOptions}=await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc=workerUrl;
  const base=import.meta.env.BASE_URL;
  const task=getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:`${base}pdfjs/cmaps/`,cMapPacked:true,standardFontDataUrl:`${base}pdfjs/standard_fonts/`,wasmUrl:`${base}pdfjs/wasm/`});
  try {
    const pdf=await task.promise;
    if(pdf.numPages>500)throw new Error("PDFは500ページ以内にしてください。");
    const result: NonNullable<AuthoringSourceUpload["pageImages"]>[number][]=[];
    let bytes=0;
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
      const page=await pdf.getPage(pageNumber),size=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(2,1800/Math.max(size.width,size.height))});
      const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvas,viewport,background:"white"}).promise;
      const dataBase64=canvas.toDataURL("image/jpeg",.88).split(",")[1]!;
      bytes+=dataBase64.length*.75;
      if(bytes+file.size>24*1024*1024)throw new Error("PDFとページ画像の合計が24MiBを超えました。教材を分割してください。");
      result.push({pageNumber,mimeType:"image/jpeg",dataBase64});
      page.cleanup();canvas.width=canvas.height=0;
    }
    return result;
  } finally {await task.destroy();}
}
