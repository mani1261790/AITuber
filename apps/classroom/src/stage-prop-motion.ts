import * as THREE from "three";
export type StagePropAction = { id:string; kind:"write"|"screen" };
export interface StagePropPose { kind:"write"|"screen"; weight:number; target:THREE.Vector3; side:"left"|"right" }
const ease=(n:number)=>THREE.MathUtils.clamp(THREE.MathUtils.smootherstep(n,0,1),0,1);
/** Small demonstration diagram. Coordinates are on the actual board plane. */
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
  let target=new THREE.Vector3(.9,2.9-progress*1.05,.21);
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
    x:writing?-.6:1.65,yaw:this.age>=duration?0:writing?Math.PI:-.65,
    pose:{kind:action.kind,weight,target,side:writing?"left":"right"} satisfies StagePropPose};
 }
}

/** Lab-only props; keep example chalk marks separate from supplied lesson content. */
export class StagePropVisuals {
 private canvas=document.createElement("canvas");
 private texture:THREE.CanvasTexture;
 private ink:THREE.Mesh;
 private cord:THREE.Line;
 private handle:THREE.Mesh;
 private chalk:THREE.Mesh;
 private lastId="";private progress=-1;
 constructor(private scene:THREE.Scene){
  this.canvas.width=1280;this.canvas.height=720;this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
  this.ink=new THREE.Mesh(new THREE.PlaneGeometry(5.65*.82,3.18*.82),new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false,toneMapped:false}));
  this.ink.position.set(-1.47,2,-.208);scene.add(this.ink);
  this.cord=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xece8dd}));scene.add(this.cord);
  this.chalk=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.11,8),new THREE.MeshBasicMaterial({color:0xf8f2dc}));this.chalk.rotation.x=Math.PI/2;scene.add(this.chalk);
  this.handle=new THREE.Mesh(new THREE.TorusGeometry(.055,.012,8,24),new THREE.MeshStandardMaterial({color:0xddd9ce}));scene.add(this.handle);
 }
 update(action:StagePropAction|undefined,frame:ReturnType<StagePropMotion["update"]>){
  this.cord.visible=this.handle.visible=action?.kind==="screen";
  this.ink.visible=action?.kind==="write";
  this.chalk.visible=action?.kind==="write" && (frame?.weight??0)>.8;
  if(frame)this.chalk.position.copy(frame.pose.target).add(new THREE.Vector3(0,0,-.195));
  if(!action||!frame)return;
  if(action.kind==="screen"){
   const bottom=new THREE.Vector3(.9,2.9-frame.progress*1.05,.02);
   const positions=this.cord.geometry.getAttribute("position") as THREE.BufferAttribute;
   positions.setXYZ(0,.9,3.44,.02);positions.setXYZ(1,bottom.x,bottom.y,bottom.z);positions.needsUpdate=true;this.cord.geometry.computeBoundingSphere();this.handle.position.copy(bottom);
  }else if(this.lastId!==action.id || frame.progress!==this.progress){
   this.lastId=action.id;this.progress=frame.progress;
   const ctx=this.canvas.getContext("2d")!;ctx.clearRect(0,0,1280,720);ctx.strokeStyle="#f6f0d9";ctx.lineWidth=4;ctx.lineCap="round";ctx.lineJoin="round";
   const pixel=(p:number[])=>[(p[0]!+1.47)/(5.65*.82)*1280+640,360-(p[1]!-2)/(3.18*.82)*720];
   for(let k=0;k<chalkPaths.length;k++){
    const path=chalkPaths[k]!,portion=THREE.MathUtils.clamp(frame.progress*chalkPaths.length-k,0,1);if(portion===0)continue;
    ctx.beginPath();const first=pixel(path[0]!);ctx.moveTo(first[0]!,first[1]!);
    const end=portion*(path.length-1);
    for(let i=1;i<=Math.floor(end);i++){const p=pixel(path[i]!);ctx.lineTo(p[0]!,p[1]!);}
    if(end%1){const a=path[Math.floor(end)]!,b=path[Math.ceil(end)]!,p=pixel([THREE.MathUtils.lerp(a[0]!,b[0]!,end%1),THREE.MathUtils.lerp(a[1]!,b[1]!,end%1)]);ctx.lineTo(p[0]!,p[1]!);}
    ctx.stroke();
   }
   this.texture.needsUpdate=true;
  }
 }
 dispose(){for(const object of [this.ink,this.cord,this.handle,this.chalk]){this.scene.remove(object);object.geometry.dispose();(object.material as THREE.Material).dispose();}this.texture.dispose();}
}
