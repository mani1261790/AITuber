import {expect,it} from 'vitest';import {storedPdfResponse} from './source-response';
it('streams the stored PDF bytes, not the emptied metadata placeholder',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.7\nfixture');const response=await storedPdfResponse(async()=>({body:new Response(bytes).body!,size:bytes.length}));
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('content-type')).toBe('application/pdf');expect(response.headers.get('cache-control')).toContain('no-store');
});
it('does not acknowledge a missing or empty source as a PDF',async()=>{
 await expect(storedPdfResponse(async()=>null)).rejects.toThrow('PDF');await expect(storedPdfResponse(async()=>({body:new Response('').body!,size:0}))).rejects.toThrow('PDF');
});
