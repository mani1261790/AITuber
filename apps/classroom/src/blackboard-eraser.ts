import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

function surfaceTexture(kind:"wood"|"felt"){
 if(typeof document==="undefined")return null;
 const canvas=document.createElement("canvas");canvas.width=256;canvas.height=128;
 const ctx=canvas.getContext("2d")!;const pixels=ctx.createImageData(256,128);
 for(let y=0;y<128;y++)for(let x=0;x<256;x++){
  const noise=((Math.imul(x+13,374761393)^Math.imul(y+41,668265263))>>>0)%1000/1000;
  const wave=y*.72+Math.sin(x*.022)*1.8+Math.sin(x*.049+y*.013)*.6;
  const knot=Math.exp(-((x-74)**2/1200+(y-81)**2/180));
  const value=kind==="wood"?242-15*Math.pow((1+Math.sin(wave+knot*8))/2,9)-noise*5:185+noise*57+Math.sin(x*.4+y*.7)*5;
  const i=(y*256+x)*4;
  pixels.data[i]=value;pixels.data[i+1]=value;pixels.data[i+2]=value;pixels.data[i+3]=255;
 }
 ctx.putImageData(pixels,0,0);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.anisotropy=4;return texture;
}

/** Hand-sized wooden chalkboard eraser. Local -Z is the felt/contact face. */
export function createBlackboardEraser(){
 const eraser=new THREE.Group();eraser.name="wood-and-felt-blackboard-eraser";
 const woodMap=surfaceTexture("wood"),feltMap=surfaceTexture("felt");
 const wood=new THREE.MeshStandardMaterial({color:0xc49b68,roughness:.72,map:woodMap,bumpMap:woodMap,bumpScale:.0005});
 const edge=new THREE.MeshStandardMaterial({color:0x765235,roughness:.85});
 const felt=new THREE.MeshStandardMaterial({color:0x566363,roughness:1,map:feltMap,bumpMap:feltMap,bumpScale:.0015});
 const seam=new THREE.MeshStandardMaterial({color:0x465452,roughness:1});
 const chalk=new THREE.MeshStandardMaterial({color:0xa6afa0,roughness:1});
 const part=(name:string,w:number,h:number,d:number,r:number,z:number,material:THREE.Material)=>{
  const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,r),material);
  mesh.name=name;mesh.position.z=z;eraser.add(mesh);return mesh;
 };
 part("beveled-wooden-grip",.36,.17,.054,.016,.009,wood);
 part("recessed-felt-retaining-rim",.352,.163,.014,.006,-.024,edge);
 part("compressed-felt-pad",.342,.153,.039,.012,-.047,felt);
 // Fine channels distinguish layered felt from a rubber/plastic block.
 for(let i=-3;i<=3;i++){
  const strip=part("felt-layer",.333,.001,.001,.0003,-.067,seam);
  strip.position.y=i*.018;
 }
 for(const side of [-1,1]){
  const groove=part("finger-grip-groove",.25,.006,.013,.003,.006,edge);
  groove.position.y=side*.084;
 }
 // A few pale chalk fibres on the contact face, deterministic and lightweight.
 for(let i=0;i<24;i++){
  const fibre=part("chalk-dust-fibre",.004+(i%4)*.002,.001,.001,.0003,-.068, chalk);
  fibre.position.x=((i*37)%101/100-.5)*.3;
  fibre.position.y=((i*23)%89/88-.5)*.12;
  fibre.rotation.z=i*.71;
 }
 // Batch details by material: five draw calls, including all grain and fibres.
 for(const material of [wood,edge,felt,seam,chalk]){
  const meshes=eraser.children.filter((child):child is THREE.Mesh=>child instanceof THREE.Mesh && child.material===material);
  const geometries=meshes.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
  const combined=mergeGeometries(geometries);
  geometries.forEach(geometry=>geometry.dispose());
  if(combined){
   meshes.forEach(mesh=>{mesh.geometry.dispose();eraser.remove(mesh);});
   const batch=new THREE.Mesh(combined,material);batch.name=meshes[0]!.name;eraser.add(batch);
  }
 }
 return eraser;
}
export function disposeBlackboardEraser(eraser:THREE.Group){
 const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 eraser.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  object.geometry.dispose();
  for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
 });
 materials.forEach(material=>{
  if(material instanceof THREE.MeshStandardMaterial)for(const texture of [material.map,material.bumpMap])if(texture)textures.add(texture);
  material.dispose();
 });
 textures.forEach(texture=>texture.dispose());
 eraser.removeFromParent();
}
