import * as THREE from "three";
export type StagePropAction = { id:string; kind:"write"|"screen" };
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
export class StagePropMotion {
 private id=""; private age=0; private arrived=false;
 update(action:StagePropAction|undefined,ready:boolean,delta:number){
  if(!action){this.id="";this.age=0;this.arrived=false;return null;}
  if(action.id!==this.id){this.id=action.id;this.age=0;this.arrived=false;}
  if(ready)this.arrived=true;
  if(this.arrived)this.age+=THREE.MathUtils.clamp(delta,0,1/30);
  const writing=action.kind==="write",duration=writing?handwritingDuration+2.4:7.2;
  const weight=this.arrived?ease(this.age/1.2)*(1-ease((this.age-(duration-1.1))/1.1)):0;
  const progress=writing?THREE.MathUtils.clamp((this.age-1.2)/handwritingDuration,0,1):ease((this.age-1.8)/2.4);
  // Reach -> close -> pull -> release -> return cord / lower arm -> settle.
  const release=ease((this.age-4.35)/.4);
  const returnCord=ease((this.age-4.8)/1.3);
  const handle=new THREE.Vector3(.9,2.55-progress*.95*(1-returnCord),.21);
  const target=writing?handwritingPoint(this.age-1.2):new THREE.Vector3(.9,2.55-progress*.95,.21);
  if(!writing)target.lerp(new THREE.Vector3(1.18,1.26,.65),ease((this.age-4.75)/1.25));
  const grip=writing?weight:ease((this.age-1.3)/.4)*(1-release);
  const wristRoll=writing && this.age>1.2 && this.age<handwritingDuration+1.2 ? .055*Math.sin((this.age-1.2)*14) : 0;
  return {phase:!this.arrived?"approach":writing?"write":this.age<1.3?"reach":this.age<1.8?"grasp":this.age<4.2?"pull":this.age<4.75?"release":this.age<6.1?"lower":"settle",kind:action.kind,progress,weight,handle,done:this.age>=duration,
    x:writing?-.6:1.35,yaw:this.age>=duration?0:writing?Math.PI:-.65,
    pose:{kind:action.kind,weight,target,side:writing?"left":"right",grip,wristRoll} satisfies StagePropPose};
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
  this.cord.visible=this.handle.visible=action?.kind==="screen";
  if(!frame || action?.kind!=="screen")return;
  const bottom=frame.handle;
  const positions=this.cord.geometry.getAttribute("position") as THREE.BufferAttribute;
  positions.setXYZ(0,.9,3.44,.02);positions.setXYZ(1,bottom.x,bottom.y,bottom.z);positions.needsUpdate=true;
  this.cord.geometry.computeBoundingSphere();this.handle.position.copy(bottom);
 }
 dispose(){for(const object of [this.cord,this.handle]){this.scene.remove(object);object.geometry.dispose();(object.material as THREE.Material).dispose();}}
}
