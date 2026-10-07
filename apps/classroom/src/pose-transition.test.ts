import { expect, it } from "vitest";
import * as THREE from "three";
import { PoseTransition, pointingHandGoal, pointingElbowGoal } from "./pose-transition.ts";

it("limits abrupt changes across head, trunk, limbs and translation, including interrupted poses", () => {
  const bones = Array.from({length: 8}, () => new THREE.Bone());
  const transition = new PoseTransition(bones);
  for (let i=0;i<180;i++) {
    const previous = bones.map(b => ({q:b.quaternion.clone(),p:b.position.clone()}));
    bones.forEach(b => { b.quaternion.setFromEuler(new THREE.Euler(i<60?2:-1, .7, 0)); b.position.set(0,i<60?.3:-.2,0); });
    transition.apply(i===60 ? 2 : 1/60);
    bones.forEach((b,j) => { expect(b.quaternion.angleTo(previous[j]!.q)).toBeLessThanOrEqual(5/30+.00001); expect(b.position.distanceTo(previous[j]!.p)).toBeLessThanOrEqual(1.5/30+.00001); });
  }
  expect(bones[0]!.position.y).toBeCloseTo(-.2,3);
});

it("gives lower targets a visibly lower hand without straightening the elbow", () => {
  const shoulder = new THREE.Vector3(2.35,2.15,.6), reach=.8;
  const hands = [2.68,2.03,1.37].map(y=>pointingHandGoal(shoulder,new THREE.Vector3(-2,y,-.06),reach));
  expect(hands[0]!.y-hands[1]!.y).toBeGreaterThan(.3);
  expect(hands[1]!.y-hands[2]!.y).toBeGreaterThan(.35);
  for(const hand of hands) expect(hand.distanceTo(shoulder)).toBeCloseTo(reach);
});


it("bounds post-blend IK changes while preserving small corrections and a frozen frame", () => {
  const bone = new THREE.Bone();
  const output = new PoseTransition([bone], Infinity);
  bone.rotation.x = .01;
  output.apply(1 / 60);
  expect(bone.rotation.x).toBeCloseTo(.01);
  const before = bone.quaternion.clone();
  bone.rotation.x = 2;
  output.apply(0);
  expect(bone.quaternion.angleTo(before)).toBeLessThan(1e-6);
  bone.rotation.x = 2;
  output.apply(1 / 60);
  expect(bone.quaternion.angleTo(before)).toBeCloseTo(5 / 60);
});

it("low pointing stays below mid pointing for the actual tall teacher shoulder", () => {
  const shoulder = new THREE.Vector3(2.23, 2.34, .48);
  const reach = .76;
  const middle = pointingHandGoal(shoulder, new THREE.Vector3(-2.14, 2.0267, -.06), reach);
  const lower = pointingHandGoal(shoulder, new THREE.Vector3(-2.14, 1.3742, -.06), reach);
  expect(middle.y - lower.y).toBeGreaterThan(.35);
  expect(lower.distanceTo(shoulder)).toBeCloseTo(reach);
});


it("retains angular and translation velocity when a pose is interrupted", () => {
  const bone = new THREE.Bone(), transition = new PoseTransition([bone]);
  const tick = (target: number, dt = 1/1000) => {
    bone.rotation.z = target; bone.position.y = target * .2; transition.apply(dt);
    return {angle: bone.rotation.z, y: bone.position.y};
  };
  let before = tick(1);
  for (let i=0;i<99;i++) before=tick(1);
  const last=tick(1), next=tick(-1);
  // A new target changes acceleration, without instantly reversing ongoing movement.
  expect(next.angle-last.angle).toBeGreaterThan(0);
  expect(next.y-last.y).toBeGreaterThan(0);
  expect(Math.abs((next.angle-last.angle)-(last.angle-before.angle))).toBeLessThan(.001);
  for(let i=0;i<1500;i++) tick(-1);
  expect(bone.rotation.z).toBeCloseTo(-1,4);
  expect(bone.position.y).toBeCloseTo(-.2,4);
});

it("does not turn when the same quaternion is supplied with opposite sign", () => {
  const bone=new THREE.Bone(); bone.rotation.set(.5,.3,-.4);
  const saved=bone.quaternion.clone(), transition=new PoseTransition([bone]);
  bone.quaternion.set(-saved.x,-saved.y,-saved.z,-saved.w);
  transition.apply(1/60);
  expect(bone.quaternion.angleTo(saved)).toBeLessThan(1e-6);
});

it("keeps a low pointing hand away from the torso instead of folding it into the skirt", () => {
  const shoulder=new THREE.Vector3(2.23,2.34,.48), reach=.76;
  const hand=pointingHandGoal(shoulder,new THREE.Vector3(-2.14,1.37,-.06),reach);
  expect(Math.hypot(hand.x-shoulder.x,hand.z-shoulder.z)).toBeGreaterThan(.3);
  expect(hand.y).toBeLessThan(1.7);
});

it("keeps spring timing consistent at 30, 60 and 120 fps", () => {
  const results=[30,60,120].map(fps=>{
    const bone=new THREE.Bone(), transition=new PoseTransition([bone]);
    for(let frame=0;frame<fps/2;frame++) {
      bone.rotation.z=.2; bone.position.y=.02; transition.apply(1/fps);
    }
    return [bone.rotation.z,bone.position.y];
  });
  for(const result of results) {
    expect(result[0]).toBeCloseTo(results[0]![0]!,6);
    expect(result[1]).toBeCloseTo(results[0]![1]!,6);
  }
});


it("uses elbow swivel to relieve the wrist without moving the hand or stretching the arm", () => {
  const shoulder=new THREE.Vector3(2.34,2.35,.44), a=.468, b=.438;
  for(const y of [2.68,2.03,1.37]) {
    const target=new THREE.Vector3(-2.1364,y,-.06);
    const hand=pointingHandGoal(shoulder,target,(a+b)*.84);
    const elbow=pointingElbowGoal(shoulder,hand,target,a,b,new THREE.Vector3(0,-1,.35));
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(a,6);
    expect(elbow.distanceTo(hand)).toBeCloseTo(b,6);
    if(y>shoulder.y)expect(elbow.y).toBeLessThanOrEqual(shoulder.y+.08001);
    expect(hand.clone().sub(elbow).angleTo(target.clone().sub(hand))).toBeLessThan(.651);
  }
});


it("extends low pointing clear of the torso without lifting the hand or locking the elbow", () => {
  for (const side of [-1,1]) {
    const shoulder=new THREE.Vector3(side*2.3,2.34,.48), target=new THREE.Vector3(-side*2.1,1.37,-.06);
    const armLength=.906, baseline=pointingHandGoal(shoulder,target,armLength*.84);
    const extended=pointingHandGoal(shoulder,target,armLength*.84,armLength*.94);
    expect(extended.y).toBeCloseTo(baseline.y,8);
    expect(Math.abs(extended.x-shoulder.x)-Math.abs(baseline.x-shoulder.x)).toBeGreaterThan(.15);
    expect(extended.distanceTo(shoulder)).toBeLessThan(armLength*.95);
    target.y=2.7;
    expect(pointingHandGoal(shoulder,target,armLength*.84,armLength*.94).distanceTo(pointingHandGoal(shoulder,target,armLength*.84))).toBeLessThan(1e-8);
  }
});

it("allows bounded faster leg recovery without relaxing the upper-body limit",()=>{
 const leg=new THREE.Bone(),arm=new THREE.Bone();
 const limiter=new PoseTransition([leg,arm],Infinity,bone=>bone===leg?8:5);
 leg.rotation.x=2;arm.rotation.x=2;limiter.apply(1/60);
 expect(leg.rotation.x).toBeCloseTo(8/60);
 expect(arm.rotation.x).toBeCloseTo(5/60);
 const saved=leg.quaternion.clone();leg.rotation.x=-2;limiter.apply(0);
 expect(leg.quaternion.angleTo(saved)).toBeLessThan(1e-6);
});

it("keeps a solved leg coordinated while limiting each joint's angular speed", () => {
  const root=new THREE.Group(),upper=new THREE.Bone(),lower=new THREE.Bone(),foot=new THREE.Bone();
  root.add(upper);upper.add(lower);lower.add(foot);lower.position.y=-1;foot.position.y=-1;
  const transition=new PoseTransition([upper,lower,foot],Infinity,()=>6,[[upper,lower,foot]]);
  for(let i=0;i<12;i++) {
    const before=[upper,lower,foot].map(b=>b.quaternion.clone());
    upper.rotation.x=.2;lower.rotation.x=-.4;foot.rotation.x=.2;
    transition.apply(1/60);root.updateMatrixWorld(true);
    [upper,lower,foot].forEach((bone,j)=>expect(bone.quaternion.angleTo(before[j]!)).toBeLessThanOrEqual(.100001));
    // Symmetric knee bending raises the foot without an artificial forward kick.
    expect(Math.abs(foot.getWorldPosition(new THREE.Vector3()).z)).toBeLessThan(1e-6);
    expect(upper.rotation.x).toBeCloseTo(-lower.rotation.x/2,6);
  }
  expect(upper.rotation.x).toBeCloseTo(.2);
  expect(lower.rotation.x).toBeCloseTo(-.4);
});
