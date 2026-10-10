import * as THREE from "three";
export type StagePropAction = { id:string; kind:"write"|"screen"|"screen-up"; writingDuration?:number; writingComplete?:boolean };
export interface StagePropPose {
 kind:"write"|"screen"; weight:number; target:THREE.Vector3; side:"left"|"right";
 grip:number; wristRoll:number;
}
const ease=(n:number)=>THREE.MathUtils.clamp(THREE.MathUtils.smootherstep(n,0,1),0,1);

// Short horizontal strokes, vertical strokes and a hook. Each stroke lifts off
// the board before repositioning; these paths animate a hand, never draw ink.
const strokes=[[[0,0],[1,0]],[[.5,.25],[.5,-.8]],[[.1,-.4],[.9,-.4],[.65,-.85]]] as const;
const writingKeys:{time:number;point:THREE.Vector3}[]=[];
let clock=0;
for(let row=0;row<2;row++)for(let letter=0;letter<4;letter++){
 for(const stroke of strokes){
  const point=(p:readonly number[],lift=0)=>new THREE.Vector3(-1.35+letter*.11+p[0]!*.075,2.32-row*.19+p[1]!*.095,.045+lift);
  const first=point(stroke[0],.035);
  if(writingKeys.length){clock+=(row>0 && letter===0 && stroke===strokes[0]) ? .6 : .085;writingKeys.push({time:clock,point:first});}
  else writingKeys.push({time:clock,point:first});
  clock+=.07;writingKeys.push({time:clock,point:point(stroke[0])});
  for(const p of stroke.slice(1)){clock+=.115;writingKeys.push({time:clock,point:point(p)});}
  clock+=.065;writingKeys.push({time:clock,point:point(stroke[stroke.length-1]!, .035)});
 }
}
export const handwritingDuration=clock;
export function handwritingPoint(time:number){
 const t=THREE.MathUtils.clamp(time,0,handwritingDuration);
 const index=writingKeys.findIndex(key=>key.time>=t);
 if(index<=0)return writingKeys[0]!.point.clone();
 const a=writingKeys[index-1]!,b=writingKeys[index]!;
 return a.point.clone().lerp(b.point,ease((t-a.time)/(b.time-a.time)));
}
/** A continuous reset stroke, with the hand lifted off the board. */
export function loopingHandwritingPoint(time:number) {
 const t=Math.max(0,time)%(handwritingDuration+.7);
 if(t<=handwritingDuration)return handwritingPoint(t);
 const p=handwritingPoint(handwritingDuration).lerp(handwritingPoint(0),ease((t-handwritingDuration)/.7));
 p.z+=.08*Math.sin(Math.PI*(t-handwritingDuration)/.7);return p;
}
export class StagePropMotion {
 private id=""; private age=0; private arrived=false;
 private stage:StagePropAction["kind"]="write"; private returningFirst=false;
 private stopAge:number|null=null; private alreadyRaised=false;
 destination(action:StagePropAction,screenVisible=false){
  if(action.id!==this.id){
   this.id=action.id;this.age=0;this.arrived=false;this.stopAge=null;
   this.alreadyRaised=action.kind==="screen-up" && !screenVisible;
   this.returningFirst=action.kind==="write" && screenVisible;
   this.stage=this.returningFirst?"screen-up":action.kind;
  }
  return {x:this.stage==="write"?-.6:1.35,yaw:this.stage==="write"?Math.PI:-.65};
 }
 update(action:StagePropAction|undefined,ready:boolean,delta:number,screenVisible=false){
  if(!action){this.id="";this.age=0;this.arrived=false;return null;}
  this.destination(action,screenVisible);
  if(this.alreadyRaised)return null;
  if(ready)this.arrived=true;
  if(this.arrived)this.age+=THREE.MathUtils.clamp(delta,0,1/30);
  const writing=this.stage==="write",raising=this.stage==="screen-up";
  const writingElapsed=Math.max(0,this.age-1.2);
  if(writing && this.stopAge===null && (action.writingComplete || writingElapsed>=(action.writingDuration??Infinity)))this.stopAge=this.age;
  const duration=writing?(this.stopAge===null?Infinity:this.stopAge+1.1):raising?5.6:7.2;
  const weight=this.arrived?ease(this.age/1.2)*(1-ease((this.age-(duration-1.1))/1.1)):0;
  const pull=ease((this.age-1.8)/(raising?.7:2.4));
  const progress=writing?Math.min(1,writingElapsed/(action.writingDuration??Infinity)):raising?1-ease((this.age-2.8)/1.9):pull;
  const release=ease((this.age-(raising?2.55:4.35))/.4);
  const returnCord=ease((this.age-(raising?2.9:4.8))/(raising?1:1.3));
  const depth=raising?.3:.95;
  const handle=new THREE.Vector3(.9,2.55-pull*depth*(1-returnCord),.21);
  const target=writing?loopingHandwritingPoint(writingElapsed):new THREE.Vector3(.9,2.55-pull*depth,.21);
  if(!writing)target.lerp(new THREE.Vector3(1.18,1.26,.65),ease((this.age-(raising?2.95:4.75))/1.25));
  const grip=writing?weight:ease((this.age-1.3)/.4)*(1-release);
  const wristRoll=writing && this.age>1.2 ? .055*Math.sin(writingElapsed*14) : 0;
  const done=this.age>=duration;
  const frame={phase:!this.arrived?"approach":writing?(this.stopAge===null?"write":"settle"):this.age<1.3?"reach":this.age<1.8?"grasp":this.age<(raising?2.5:4.2)?"pull":this.age<(raising?2.95:4.75)?"release":this.age<(raising?4.5:6.1)?"lower":"settle",
    kind:writing?"write" as const:"screen" as const,progress,weight,handle,done:done&&!this.returningFirst,writingElapsed:writing?writingElapsed:0,
    x:writing?-.6:1.35,yaw:done&&!this.returningFirst?0:writing?Math.PI:-.65,
    pose:{kind:writing?"write":"screen",weight,target,side:writing?"left":"right",grip,wristRoll} satisfies StagePropPose};
  if(done && this.returningFirst){this.returningFirst=false;this.stage="write";this.age=0;this.arrived=false;}
  return frame;
 }
}

/** The cord has its own pulley trajectory. It never chases the hand. */
export class StagePropVisuals {
 private cord:THREE.Line;
 private handle:THREE.Mesh;
 constructor(private scene:THREE.Scene){
  this.cord=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xece8dd}));scene.add(this.cord);
  this.handle=new THREE.Mesh(new THREE.TorusGeometry(.055,.012,8,24),new THREE.MeshStandardMaterial({color:0xddd9ce}));scene.add(this.handle);
 }
 update(action:StagePropAction|undefined,frame:ReturnType<StagePropMotion["update"]>){
  this.cord.visible=this.handle.visible=Boolean(action && frame?.kind==="screen" && !frame.done);
  if(!frame || frame.kind!=="screen")return;
  const bottom=frame.handle;
  const positions=this.cord.geometry.getAttribute("position") as THREE.BufferAttribute;
  positions.setXYZ(0,.9,3.44,.02);positions.setXYZ(1,bottom.x,bottom.y,bottom.z);positions.needsUpdate=true;
  this.cord.geometry.computeBoundingSphere();this.handle.position.copy(bottom);
 }
 dispose(){for(const object of [this.cord,this.handle]){this.scene.remove(object);object.geometry.dispose();(object.material as THREE.Material).dispose();}}
}
