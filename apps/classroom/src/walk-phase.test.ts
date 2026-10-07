import {expect,it} from "vitest";
import * as THREE from "three";
import {closestWalkPhase} from "./walk-phase.ts";
it("matches actual ankle placement including the gait's pelvis translation",()=>{
 const root=new THREE.Group(),hips=new THREE.Bone(),foot=new THREE.Bone();
 hips.name="hips";foot.name="foot";root.add(hips);hips.add(foot);
 root.position.set(2,-.6,.6);root.rotation.y=.7;root.scale.setScalar(1.8);
 hips.position.y=1;foot.position.y=-.9;root.updateMatrixWorld(true);
 const original=foot.getWorldPosition(new THREE.Vector3());
 const identity=[0,0,0,1];
 const clip=new THREE.AnimationClip("walk",1,[
  new THREE.QuaternionKeyframeTrack("foot.quaternion",[0,.5,1],[...identity,...identity,...identity]),
  new THREE.VectorKeyframeTrack("hips.position",[0,.5,1],[0,.8,.2,0,1,0,0,.8,.2]),
 ]);
 expect(closestWalkPhase(clip,[hips,foot],2,[foot])).toBe(.5);
 expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(original)).toBe(0);
 expect(hips.position.toArray()).toEqual([0,1,0]);
});
it("chooses the matching cyclic leg pose without modifying bones or the clip",()=>{
 const leg=new THREE.Bone();leg.name="leg";leg.rotation.x=.8;
 const identity=new THREE.Quaternion(),raised=leg.quaternion.clone();
 const track=new THREE.QuaternionKeyframeTrack("leg.quaternion",[0,.5,1],[...identity.toArray(),...raised.toArray(),...identity.toArray()]);
 const clip=new THREE.AnimationClip("walk",1,[track]),values=Array.from(track.values);
 expect(closestWalkPhase(clip,[leg])).toBeCloseTo(.5);
 expect(leg.quaternion.angleTo(raised)).toBeLessThan(1e-6);
 expect(Array.from(track.values)).toEqual(values);
 leg.quaternion.identity();expect(closestWalkPhase(clip,[leg])).toBe(0);
});
it("ignores unrelated tracks and handles a rig without matching leg tracks",()=>{
 const clip=new THREE.AnimationClip("walk",1,[new THREE.VectorKeyframeTrack("hips.position",[0,1],[0,0,0,0,1,0])]);
 expect(closestWalkPhase(clip,[])).toBe(0);
});

it("prefers a nearby planted foot over a better angular match that moves it away",()=>{
 const root=new THREE.Group(),upper=new THREE.Bone(),foot=new THREE.Bone();
 upper.name="upper";foot.name="foot";root.add(upper);upper.add(foot);foot.position.y=-1;
 root.position.set(3,2,-1);root.rotation.y=.7;root.updateMatrixWorld(true);
 const identity=new THREE.Quaternion().toArray();
 const bent=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.6).toArray();
 const rolled=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),1).toArray();
 const clip=new THREE.AnimationClip("walk",1,[
  new THREE.QuaternionKeyframeTrack("upper.quaternion",[0,.5,1],[...identity,...bent,...identity]),
  new THREE.QuaternionKeyframeTrack("foot.quaternion",[0,.5,1],[...rolled,...identity,...rolled]),
 ]);
 const original=foot.getWorldPosition(new THREE.Vector3());
 expect(closestWalkPhase(clip,[upper,foot],2)).toBe(.5);
 expect(closestWalkPhase(clip,[upper,foot],2,[foot])).toBe(0);
 expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(original)).toBe(0);
 expect(upper.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
 expect(foot.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
});
