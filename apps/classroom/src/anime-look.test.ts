import {expect,it,vi} from "vitest";
import * as THREE from "three";
import {MToonMaterial} from "@pixiv/three-vrm";
import {AnimeLook} from "./anime-look.ts";

it("restores authored character and room materials after comparison",()=>{
  const root=new THREE.Group(),mtoon=new MToonMaterial(),roomMaterial=new THREE.MeshStandardMaterial({transparent:true,opacity:.4,alphaTest:.2});
  mtoon.shadingToonyFactor=.4;
  const character=new THREE.Mesh(new THREE.BoxGeometry(),mtoon),room=new THREE.Mesh(new THREE.BoxGeometry(),roomMaterial);root.add(character,room);
  const look=new AnimeLook();look.registerCharacter(character);look.registerRoom(room);look.apply("anime");
  expect(mtoon.shadingToonyFactor).toBe(1);expect(room.material).toBeInstanceOf(THREE.MeshToonMaterial);
  expect(room.material.opacity).toBe(.4);expect(room.material.alphaTest).toBe(.2);
  look.apply("original");expect(mtoon.shadingToonyFactor).toBe(.4);expect(room.material).toBe(roomMaterial);
  look.apply("anime");look.dispose();expect(room.material).toBe(roomMaterial);
  root.traverse(node=>{if(node instanceof THREE.Mesh)node.geometry.dispose();});mtoon.dispose();roomMaterial.dispose();
});

it("preserves eye shading while keeping the authored warm skin shadow",()=>{
 const eye=new MToonMaterial(),skin=new MToonMaterial();eye.name="EyeIris";skin.name="Face_SKIN";eye.shadingShiftFactor=.71;eye.shadeColorFactor.setRGB(1,1,1);skin.shadeColorFactor.setRGB(.93,.62,.71);
 const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),eye),new THREE.Mesh(new THREE.BoxGeometry(),skin));
 const look=new AnimeLook();look.registerCharacter(root);look.apply("anime");expect(eye.shadingShiftFactor).toBe(.71);expect(eye.shadeColorFactor.r).toBe(1);expect(skin.shadeColorFactor.r).toBe(.93);expect(skin.shadeColorFactor.g).toBe(.62);
 look.dispose();root.traverse(n=>{if(n instanceof THREE.Mesh)n.geometry.dispose();});eye.dispose();skin.dispose();
});

it("adds the missing hair outline draw pass without changing skinning or shared geometry",()=>{
 const material=new MToonMaterial();material.name="Teacher_HAIR";
 const geometry=new THREE.PlaneGeometry(),mesh=new THREE.SkinnedMesh<THREE.BufferGeometry,MToonMaterial|MToonMaterial[]>(geometry,material),root=new THREE.Group();root.add(mesh);
 const skeleton=new THREE.Skeleton([new THREE.Bone()]);mesh.bind(skeleton);
 const originalGroups=structuredClone(geometry.groups),look=new AnimeLook();
 look.registerCharacter(root);look.apply("anime");
 expect(mesh.material).toHaveLength(2);
 const outline=(mesh.material as MToonMaterial[])[1]!;
 expect(outline.isOutline).toBe(true);expect(outline.side).toBe(THREE.BackSide);
 expect(mesh.geometry.groups.map(g=>g.materialIndex)).toEqual([0,1]);
 expect(mesh.skeleton).toBe(skeleton);expect(geometry.groups).toEqual(originalGroups);
 look.apply("original");expect(mesh.material).toBe(material);expect(mesh.geometry).toBe(geometry);
 look.apply("anime");const dispose=vi.spyOn(mesh.geometry,"dispose");look.dispose();
 expect(dispose).toHaveBeenCalledOnce();expect(mesh.geometry).toBe(geometry);expect(mesh.material).toBe(material);
 geometry.dispose();material.dispose();skeleton.dispose();
});

it("uploads authored cutout thresholds and UV animation instead of drawing transparent cloth black",()=>{
 const material=new MToonMaterial();material.name="Teacher_CLOTH";material.alphaTest=.5;
 material.uvAnimationScrollXSpeedFactor=.2;
 const geometry=new THREE.PlaneGeometry(),mesh=new THREE.Mesh(geometry,material),look=new AnimeLook();
 look.registerCharacter(mesh);look.apply("anime");
 expect(material.uniforms.alphaTest!.value).toBe(.5);
 const start=material.uniforms.uvAnimationScrollXOffset!.value as number;
 look.update(.25);
 expect(material.uniforms.uvAnimationScrollXOffset!.value).toBeCloseTo(start+.05);
 look.apply("original");expect(material.uniforms.alphaTest!.value).toBe(.5);
 look.dispose();geometry.dispose();material.dispose();
});
