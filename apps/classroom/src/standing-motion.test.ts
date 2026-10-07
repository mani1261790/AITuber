import {expect,it} from "vitest";
import * as THREE from "three";
import type {VRM} from "@pixiv/three-vrm";
import {withTeacherStance} from "./standing-motion.ts";

it("keeps feet planted through a loop and narrows the stance without changing bone lengths",()=>{
  for(const version of ["0","1"]) {
    const scene=new THREE.Group(),orientation=new THREE.Group(),hips=new THREE.Bone();
    scene.position.set(2,-.6,.6);scene.scale.setScalar(1.8);scene.rotation.y=-.26;
    scene.add(orientation);orientation.rotation.y=version==="0"?Math.PI:0;orientation.add(hips);
    hips.name="hips";hips.position.y=.92;
    const nodes:Record<string,THREE.Bone>={hips};
    for(const side of ["left","right"]){
      const upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
      hips.add(upper);upper.add(lower);lower.add(foot);upper.position.x=side==="left"?.075:-.075;
      lower.position.y=-.4;foot.position.y=-.4;
      for(const [part,node] of [["UpperLeg",upper],["LowerLeg",lower],["Foot",foot]] as const){node.name=side+part;nodes[node.name]=node;}
    }
    const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>nodes[name]??null}} as unknown as VRM;
    const source=new THREE.AnimationClip("idle",6,[new THREE.QuaternionKeyframeTrack("leftUpperLeg.quaternion",[0,6],[0,.3,0,.954,0,.3,0,.954])]);
    const original=Array.from(source.tracks[0]!.values);
    const clip=withTeacherStance(vrm,source);
    expect(Array.from(source.tracks[0]!.values)).toEqual(original);
    expect(nodes.leftUpperLeg!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    const mixer=new THREE.AnimationMixer(scene);mixer.clipAction(clip).play();
    let first:THREE.Vector3[]|undefined,previous:THREE.Vector3[]|undefined;
    for(let i=0;i<=360;i++){
      mixer.setTime(i/60);scene.updateMatrixWorld(true);
      const feet=[nodes.leftFoot!,nodes.rightFoot!].map(node=>node.getWorldPosition(new THREE.Vector3()));
      first??=feet.map(p=>p.clone());
      feet.forEach((p,j)=>expect(p.distanceTo(first![j]!)).toBeLessThan(.0001));
      const knees=[nodes.leftLowerLeg!,nodes.rightLowerLeg!].map(node=>node.getWorldPosition(new THREE.Vector3()));
      if(previous)knees.forEach((p,j)=>expect(p.distanceTo(previous![j]!)).toBeLessThan(.002));
      previous=knees;
      expect(feet[0]!.distanceTo(feet[1]!)).toBeCloseTo(.15*.7*1.8,3);
      expect(nodes.leftLowerLeg!.position.length()).toBeCloseTo(.4);
      const rootInverse=scene.getWorldQuaternion(new THREE.Quaternion()).invert();
      const forward=nodes.leftFoot!.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInverse);
      const toeDirection=new THREE.Vector3(0,0,1).applyQuaternion(forward);
      const footLocal=scene.worldToLocal(feet[0]!.clone());
      expect(toeDirection.x*footLocal.x).toBeLessThan(0);
      expect(Math.abs(toeDirection.x)).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(7)),4);
    }
  }
});
