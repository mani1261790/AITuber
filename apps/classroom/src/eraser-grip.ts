import * as THREE from "three";
import type {VRM} from "@pixiv/three-vrm";
// Palm faces the board; fingers cross the short side of the upright eraser.
export const eraserHandOrientation=new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,0));
export const eraserPalmClearance=.07;
export function eraserPalmPosition(vrm:VRM,raw=false){
 const get=(name:"leftHand"|"leftMiddleProximal")=>raw?vrm.humanoid.getRawBoneNode(name):vrm.humanoid.getNormalizedBoneNode(name);
 const hand=get("leftHand"),knuckle=get("leftMiddleProximal");
 if(!hand||!knuckle)return null;
 return hand.getWorldPosition(new THREE.Vector3()).lerp(knuckle.getWorldPosition(new THREE.Vector3()),.8);
}
export function applyEraserFingers(vrm:VRM,weight:number){
 for(const [finger,angles] of [["Index",[.20,1.05,.75]],["Middle",[.20,1.10,.80]],["Ring",[.12,.90,.65]],["Little",[.05,.40,.30]]] as const){
  for(const [i,part] of (["Proximal","Intermediate","Distal"] as const).entries()){
   const joint=vrm.humanoid.getNormalizedBoneNode(`left${finger}${part}`);
   joint?.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angles[i]!),weight);
  }
 }
 for(const [i,part] of (["Metacarpal","Proximal","Distal"] as const).entries()){
  const joint=vrm.humanoid.getNormalizedBoneNode(`leftThumb${part}`);
  joint?.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(.12,[.3,.2,.1][i],[-.3,.25,.35][i])),weight);
 }
}
/** The back of the wooden grip meets the palm; the block never sits inside a finger. */
export function eraserHeldTransform(palm:THREE.Vector3,handOrientation:THREE.Quaternion){
 const frame=handOrientation.clone().multiply(eraserHandOrientation.clone().invert());
 return {position:palm.clone().add(new THREE.Vector3(0,0,-eraserPalmClearance).applyQuaternion(frame)),quaternion:frame.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2))};
}
