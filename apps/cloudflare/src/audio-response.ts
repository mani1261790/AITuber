/** Preserve seekable media semantics on Safari and other browser audio clients. */
export function audioResponse(request:Request,bytes:Uint8Array,mimeType:string):Response {
  const headers=new Headers({'content-type':mimeType,'accept-ranges':'bytes','cache-control':'no-store'});
  const range=!request.headers.has('if-range') && /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  let start=0,end=bytes.length-1,partial=false;
  if(range && (range[1] || range[2])) {
    partial=true;
    if(!range[1]){const suffix=Number(range[2]);start=Number.isSafeInteger(suffix)&&suffix>0?Math.max(0,bytes.length-suffix):bytes.length;}
    else {start=Number(range[1]);if(range[2])end=Math.min(end,Number(range[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length){headers.set('content-range',`bytes */${bytes.length}`);headers.set('content-length','0');return new Response(null,{status:416,headers});}
    headers.set('content-range',`bytes ${start}-${end}/${bytes.length}`);
  }
  headers.set('content-length',String(Math.max(0,end-start+1)));
  return new Response(request.method==='HEAD'?null:bytes.slice(start,end+1),{status:partial?206:200,headers});
}
