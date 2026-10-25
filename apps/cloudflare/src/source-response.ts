import {pdfSourceHeaders} from '../../server/src/lesson-pdf-source';
/** Source bytes live in R2 after ingestion; SQLite retains only the file metadata. */
export async function storedPdfResponse(get:()=>Promise<{body:ReadableStream;size:number}|null>){
 const object=await get();if(!object||object.size===0)throw new RangeError('元のPDFを取得できません');
 return new Response(object.body,{headers:{...pdfSourceHeaders,'content-length':String(object.size)}});
}
