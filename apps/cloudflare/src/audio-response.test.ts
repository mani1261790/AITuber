import { expect,it } from 'vitest';
import { audioResponse } from './audio-response';
const bytes=new Uint8Array([0,1,2,3,4,5]);
it.each([['bytes=1-3',[1,2,3]],['bytes=4-',[4,5]],['bytes=-2',[4,5]]] as const)('serves %s',async(range,expected)=>{
 const response=audioResponse(new Request('https://example.com',{headers:{range}}),bytes,'audio/mpeg');
 expect(response.status).toBe(206);expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected);expect(response.headers.get('cache-control')).toBe('no-store');
});
it('rejects unsatisfiable ranges and preserves HEAD metadata',async()=>{
 expect(audioResponse(new Request('https://example.com',{headers:{range:'bytes=6-'}}),bytes,'audio/mpeg').status).toBe(416);
 const head=audioResponse(new Request('https://example.com',{method:'HEAD',headers:{range:'bytes=-2'}}),bytes,'audio/mpeg');expect(head.headers.get('content-length')).toBe('2');expect((await head.arrayBuffer()).byteLength).toBe(0);
});
it('ignores unsupported ranges and If-Range without a validator',()=>{
 for(const headers of [{range:'bytes=0-1,4-5'},{range:'bytes=1-2','if-range':'"unknown"'}])expect(audioResponse(new Request('https://example.com',{headers}),bytes,'audio/mpeg').status).toBe(200);
});
