import {expect,it} from "vitest";
import {validateVrmaBuffer} from "./vrma-preview.tsx";
function glb(json:object){const source=new TextEncoder().encode(JSON.stringify(json));const length=Math.ceil(source.length/4)*4;const buffer=new ArrayBuffer(20+length);const data=new DataView(buffer);data.setUint32(0,0x46546c67,true);data.setUint32(4,2,true);data.setUint32(8,buffer.byteLength,true);data.setUint32(12,length,true);data.setUint32(16,0x4e4f534a,true);new Uint8Array(buffer,20).fill(32);new Uint8Array(buffer,20,source.length).set(source);return buffer;}
it("accepts self contained VRMA headers and rejects external resource requests",()=>{
 const base={extensions:{VRMC_vrm_animation:{specVersion:"1.0"}}};
 expect(()=>validateVrmaBuffer(glb(base))).not.toThrow();
 expect(()=>validateVrmaBuffer(glb({...base,buffers:[{uri:"https://example.com/private"}]}))).toThrow("外部");
 expect(()=>validateVrmaBuffer(glb({...base,images:[{uri:"secret.png"}]}))).toThrow("外部");
 expect(()=>validateVrmaBuffer(glb({asset:{version:"2.0"}}))).toThrow("情報");
 expect(()=>validateVrmaBuffer(new ArrayBuffer(4))).toThrow();
});
