import {expect,it} from "vitest";
import * as THREE from "three";
import type {VRM} from "@pixiv/three-vrm";
import {AvatarGrounding,floorHeight} from "./avatar-grounding.ts";
it("finds transformed upward-facing floor geometry rather than a fixed ankle height",()=>{
 const room=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(10,.2,10),new THREE.MeshBasicMaterial());floor.position.y=-.9;room.add(floor);room.position.y=.2;room.updateMatrixWorld(true);
 expect(floorHeight(room,new THREE.Vector3(2,3,1))).toBeCloseTo(-.6);
});
it("calibrates the sole from skinned vertices and eases it to the floor",()=>{
 const root=new THREE.Group(),foot=new THREE.Bone();root.add(foot);foot.position.y=.2;
 const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,-.1,0,.1,-.1,.1,0,0,0],3));geometry.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(new Array(12).fill(0),4));geometry.setAttribute("skinWeight",new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([foot]));
 const vrm={scene:root,humanoid:{getRawBoneNode:(name:string)=>name==="leftFoot"?foot:null}} as unknown as VRM;
 const grounding=new AvatarGrounding(vrm);expect(grounding.positions()[0]!.y).toBeCloseTo(-.1);
 for(let i=0;i<90;i++)grounding.apply(root,()=>-.6,1/60);
 expect(grounding.positions()[0]!.y).toBeCloseTo(-.6,3);
});


it("corrects shallow penetration promptly without jumping across a changed floor",()=>{
 const root=new THREE.Group(),foot=new THREE.Bone();root.add(foot);
 const vrm={scene:root,humanoid:{getRawBoneNode:(name:string)=>name==="leftFoot"?foot:null}} as unknown as VRM;
 const ground=new AvatarGrounding(vrm);
 const floor=ground.positions()[0]!.y+.02;
 ground.apply(root,()=>floor,1/60);expect(floor-ground.positions()[0]!.y).toBeLessThan(.008);
 const before=root.position.y;ground.apply(root,()=>10,3);
 expect(root.position.y-before).toBeLessThanOrEqual(.05+1e-9);
 const after=root.position.y;ground.apply(root,()=>10,0);expect(root.position.y).toBe(after);
});
