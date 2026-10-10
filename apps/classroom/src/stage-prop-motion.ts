import * as THREE from "three";
export type StagePropAction = { id:string; kind:"write"|"screen" };
export interface StagePropPose { kind:"write"|"screen"; weight:number; target:THREE.Vector3; side:"left"|"right" }
const ease=(n:number)=>THREE.MathUtils.clamp(THREE.MathUtils.smootherstep(n,0,1),0,1);
/** Hand paths only. This gesture never draws onto the board. */
export const chalkPaths: number[][][] = [
 [[-1.5,1.75],[-.7,1.75]], [[-1.4,1.65],[-1.4,2.6]],
 Array.from({length:41},(_,i)=>{const x=i/40;return [-1.35+x*.6,1.88+(x-.45)**2*2.1];}),
];
export function chalkPoint(progress:number){
 const scaled=THREE.MathUtils.clamp(progress,0,.999999)*chalkPaths.length,index=Math.floor(scaled);
 const path=chalkPaths[index]!,t=(scaled-index)*(path.length-1),i=Math.floor(t);
 const a=path[i]!,b=path[Math.min(i+1,path.length-1)]!;
 return new THREE.Vector3(THREE.MathUtils.lerp(a[0]!,b[0]!,t-i),THREE.MathUtils.lerp(a[1]!,b[1]!,t-i),-.205);
}
export class StagePropMotion {
 private id=""; private age=0; private arrived=false;
 update(action:StagePropAction|undefined,ready:boolean,delta:number){
  if(!action){this.id="";this.age=0;this.arrived=false;return null;}
  if(action.id!==this.id){this.id=action.id;this.age=0;this.arrived=false;}
  if(ready)this.arrived=true;
  if(this.arrived)this.age+=THREE.MathUtils.clamp(delta,0,1/30);
  const writing=action.kind==="write",duration=writing?9:6;
  const weight=this.arrived?ease(this.age/.9)*(1-ease((this.age-(duration-1))/1)):0;
  let progress=this.arrived?ease((this.age-1.1)/(writing?5.5:3.4)):0;
  let target=new THREE.Vector3(.9,2.65-progress*.8,.21);
  if(writing){
    const clock=Math.max(0,this.age-1.1),stroke=Math.min(2,Math.floor(clock/2.15)),local=clock-stroke*2.15;
    progress=(stroke+Math.min(1,local/1.5))/3;
    target=chalkPoint(Math.max(0,progress-(local>=1.5?1e-7:0))).add(new THREE.Vector3(0,0,.25));
    if(local>1.5 && stroke<2){
      const from=chalkPaths[stroke]!.at(-1)!,to=chalkPaths[stroke+1]![0]!,t=THREE.MathUtils.clamp((local-1.5)/.65,0,1);
      target.set(THREE.MathUtils.lerp(from[0]!,to[0]!,ease(t)),THREE.MathUtils.lerp(from[1]!,to[1]!,ease(t)),.045+.09*Math.sin(Math.PI*t));
    }
  }
  return {kind:action.kind,progress,weight,done:this.age>=duration,
    x:writing?-.6:1.35,yaw:this.age>=duration?0:writing?Math.PI:-.65,
    pose:{kind:action.kind,weight,target,side:writing?"left":"right"} satisfies StagePropPose};
 }
}

/** A visible cord follows the rendered grip, after pose blending and IK. No ink layer. */
export class StagePropVisuals {
 private cord:THREE.Line;
 private handle:THREE.Mesh;
 constructor(private scene:THREE.Scene){
  this.cord=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xece8dd}));scene.add(this.cord);
  this.handle=new THREE.Mesh(new THREE.TorusGeometry(.055,.012,8,24),new THREE.MeshStandardMaterial({color:0xddd9ce}));scene.add(this.handle);
 }
 update(action:StagePropAction|undefined,frame:ReturnType<StagePropMotion["update"]>,grip?:THREE.Vector3){
  this.cord.visible=this.handle.visible=action?.kind==="screen";
  if(!frame || action?.kind!=="screen")return;
  const bottom=frame.pose.target.clone();
  // Smooth acquisition/release, exact contact while pulling. Use the actual
  // rendered finger bones, not the pre-IK target or a fixed depth offset.
  if(grip)bottom.lerp(grip,ease(frame.weight));
  const positions=this.cord.geometry.getAttribute("position") as THREE.BufferAttribute;
  positions.setXYZ(0,.9,3.44,.02);positions.setXYZ(1,bottom.x,bottom.y,bottom.z);positions.needsUpdate=true;
  this.cord.geometry.computeBoundingSphere();this.handle.position.copy(bottom);
 }
 dispose(){for(const object of [this.cord,this.handle]){this.scene.remove(object);object.geometry.dispose();(object.material as THREE.Material).dispose();}}
}
