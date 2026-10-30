import {useEffect,useRef,useState,type ReactNode} from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {PDFDocumentProxy} from 'pdfjs-dist';
export function usePackageSlides(id:string){
 const cache=useRef(new Map<string,{promise:Promise<PDFDocumentProxy>;dispose():void}>());
 useEffect(()=>{const documents=cache.current;return()=>{for(const entry of documents.values())entry.dispose();documents.clear();};},[id]);
 return (sourceId:string)=>{
  const existing=cache.current.get(sourceId);if(existing)return existing.promise;
  const controller=new AbortController();let dispose=()=>controller.abort();
  const promise=(async()=>{const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist');GlobalWorkerOptions.workerSrc=workerUrl;
   const response=await fetch(`/api/packages/${encodeURIComponent(id)}/source?sourceId=${encodeURIComponent(sourceId)}&representation=pdf`,{signal:controller.signal,headers:{'x-aituber-surface':'operator'}});if(!response.ok)throw Error('スライドを取得できません');const data=new Uint8Array(await response.arrayBuffer());controller.signal.throwIfAborted();
   const base=import.meta.env.BASE_URL;const task=getDocument({data,cMapUrl:`${base}pdfjs/cmaps/`,cMapPacked:true,standardFontDataUrl:`${base}pdfjs/standard_fonts/`,wasmUrl:`${base}pdfjs/wasm/`});dispose=()=>{controller.abort();void task.destroy();};return task.promise;
  })();cache.current.set(sourceId,{promise,dispose:()=>dispose()});return promise;
 };
}
export function PackageSlide({sourceId,pageNumber,load,overlay}:{overlay?:ReactNode;sourceId:string;pageNumber:number;load:(sourceId:string)=>Promise<PDFDocumentProxy>}){
 const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),loader=useRef(load);loader.current=load;
 const [near,setNear]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const observer=new IntersectionObserver(entries=>setNear(entries.some(entry=>entry.isIntersecting)),{rootMargin:'400px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!near)return;let cancelled=false;let cancel:(()=>void)|undefined;const target=canvas.current;
  void(async()=>{try{const pdf=await loader.current(sourceId);const page=await pdf.getPage(pageNumber);if(cancelled||!target)return;const size=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1200/Math.max(size.width,size.height))});target.width=viewport.width;target.height=viewport.height;const task=page.render({canvas:target,viewport,background:'white'});cancel=()=>task.cancel();await task.promise;if(!cancelled)setReady(true);}catch(error){if(!cancelled)setError(error instanceof Error?error.message:'表示できません');}})();
  return()=>{cancelled=true;cancel?.();if(target){target.width=0;target.height=0;}setReady(false);};
 },[near,sourceId,pageNumber]);
 return <div ref={host} className={`package-slide${ready?" is-ready":""}`}>{!ready&&!error&&<span role="status">スライドを読み込み中…</span>}{error&&<p role="alert">{error}</p>}<canvas ref={canvas} style={{visibility:ready?'visible':'hidden'}} aria-label={`スライド ${pageNumber}ページ`}/>{ready&&overlay}</div>;
}
