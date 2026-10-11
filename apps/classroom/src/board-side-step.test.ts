import {expect,it} from "vitest";
import {sideStepOffset} from "./board-side-step.ts";
import {StageLocomotion} from "./stage-locomotion.ts";
it("moves laterally without changing board-facing yaw or overshooting",()=>{
 for(const goal of [-1.4,1.4]){
  const motion=new StageLocomotion(0,Math.PI);
  let previous=0;
  for(let i=0;i<300;i++){
   motion.updateSideStep(1/60,goal);
   expect(motion.yaw).toBe(Math.PI);expect(motion.phase).not.toBe("turn");
   expect(Math.abs(motion.x-previous)).toBeLessThan(.023);previous=motion.x;
  }
  expect(motion.x).toBeCloseTo(goal);expect(motion.phase).toBe("idle");
 }
});
it("plants the support foot and lifts only the swinging foot",()=>{
 const base={start:0,goal:1.4};
 for(let p=0;p<3;p+=.01){
  const lead=sideStepOffset({...base,progress:p},true),trail=sideStepOffset({...base,progress:p},false);
  expect(Math.min(lead.lift,trail.lift)).toBeCloseTo(0);
  expect(Math.max(lead.lift,trail.lift)).toBeLessThanOrEqual(.066);
 }
 expect(sideStepOffset({...base,progress:3},true).x).toBe(1.4);
 expect(sideStepOffset({...base,progress:3},false).x).toBe(1.4);
});

it("keeps grounding translation independent of the foot-placement constraint",async()=>{
 const THREE=await import("three"),{BoardSideStep}=await import("./board-side-step.ts");
 const scene=new THREE.Group(),bones=new Map<string,import("three").Object3D>();
 for(const side of ["left","right"]){
  const upper=new THREE.Group(),lower=new THREE.Group(),foot=new THREE.Group();
  upper.position.set(side==="left"?-.12:.12,1,0);lower.position.set(0,-.45,.02);foot.position.set(0,-.45,-.02);
  scene.add(upper);upper.add(lower);lower.add(foot);
  bones.set(`${side}UpperLeg`,upper);bones.set(`${side}LowerLeg`,lower);bones.set(`${side}Foot`,foot);
 }
 const vrm={scene,humanoid:{getNormalizedBoneNode:(name:string)=>bones.get(name)}} as unknown as import("@pixiv/three-vrm").VRM;
 const motion=new BoardSideStep(vrm),step={start:0,goal:.4,progress:0};motion.apply(step);
 const before=bones.get("leftFoot")!.getWorldPosition(new THREE.Vector3());
 scene.position.y=2;motion.apply(step);
 const after=bones.get("leftFoot")!.getWorldPosition(new THREE.Vector3());
 expect(after.y-before.y).toBeCloseTo(2,3);expect(after.x).toBeCloseTo(before.x,3);
});
