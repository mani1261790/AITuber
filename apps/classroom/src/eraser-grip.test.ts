import {expect,it} from "vitest";
import * as THREE from "three";
import {eraserHeldTransform,eraserHandOrientation,eraserPalmClearance} from "./eraser-grip.ts";
it("keeps the wooden back in front of the palm rather than centering the block inside the fingers",()=>{
 const palm=new THREE.Vector3(1,2,.1),held=eraserHeldTransform(palm,eraserHandOrientation);
 expect(held.position.x).toBeCloseTo(palm.x);expect(held.position.y).toBeCloseTo(palm.y);
 expect(palm.z-(held.position.z+.036)).toBeGreaterThan(.03);
 expect(palm.distanceTo(held.position)).toBeCloseTo(eraserPalmClearance);
});
it("carries the offset and orientation with the hand when lifting away from the board",()=>{
 const palm=new THREE.Vector3(1,2,.1),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(.4,.7,.2));
 const held=eraserHeldTransform(palm,q);
 expect(held.position.distanceTo(palm)).toBeCloseTo(eraserPalmClearance);
 const back=new THREE.Vector3(0,0,1).applyQuaternion(held.quaternion);
 expect(palm.clone().sub(held.position).normalize().dot(back)).toBeCloseTo(1);
});
