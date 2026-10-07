import * as THREE from "three";

/** Architectural finishes shared by the room and the teaching stage. */
export function classroomMaterials() {
  const loader = new THREE.TextureLoader();
  const maps = ["wood-color","wood-normal","wood-roughness"].map(name => {
    const texture = loader.load(`/models/environment/textures/${name}.jpg`);
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.repeat.set(3,3); return texture;
  });
  maps[0]!.colorSpace=THREE.SRGBColorSpace;
  const wood = new THREE.MeshStandardMaterial({map:maps[0]!,normalMap:maps[1]!,roughnessMap:maps[2]!,roughness:.8,normalScale:new THREE.Vector2(.25,.25)});
  const canvas = document.createElement("canvas"); canvas.width=canvas.height=128;
  const ctx = canvas.getContext("2d")!; const pixels=ctx.createImageData(128,128);
  let seed=341;
  for(let i=0;i<pixels.data.length;i+=4) { seed=(seed*1664525+1013904223)>>>0; const value=180+(seed%45); pixels.data.set([value,value,value,255],i); }
  ctx.putImageData(pixels,0,0);
  const plaster = new THREE.CanvasTexture(canvas); plaster.wrapS=plaster.wrapT=THREE.RepeatWrapping; plaster.repeat.set(8,4);
  return { wood, plaster, dispose() { wood.dispose(); maps.forEach(map=>map.dispose()); plaster.dispose(); } };
}
