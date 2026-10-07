import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

/** Calibrate shoe soles from rendered vertices once, then follow their foot bones. */
export class AvatarGrounding {
  private soles: {foot:THREE.Object3D; local:THREE.Vector3[]}[]=[];
  constructor(vrm:VRM) {
    vrm.scene.updateMatrixWorld(true);
    const feet=(["leftFoot","rightFoot"] as const).flatMap(name=>{const foot=vrm.humanoid.getRawBoneNode(name);return foot?[{foot,ankle:foot.getWorldPosition(new THREE.Vector3()),points:[] as THREE.Vector3[]}]:[];});
    vrm.scene.traverse(node=>{
      if(!(node instanceof THREE.SkinnedMesh))return;
      node.skeleton.update();
      const count=node.geometry.getAttribute("position").count,point=new THREE.Vector3();
      for(let i=0;i<count;i++){
        node.getVertexPosition(i,point);node.localToWorld(point);
        const f=feet.reduce<typeof feet[number]|undefined>((closest,item)=>!closest||point.distanceToSquared(item.ankle)<point.distanceToSquared(closest.ankle)?item:closest,undefined);
        if(f&&point.y<=f.ankle.y+.02&&point.distanceTo(f.ankle)<.45)f.points.push(point.clone());
      }
    });
    this.soles=feet.map(f=>{
      const lowest=Math.min(...f.points.map(p=>p.y));
      const bottom=f.points.filter(p=>p.y<=lowest+.025);
      if(!bottom.length)bottom.push(f.ankle.clone().add(new THREE.Vector3(0,-.08,0)));
      const selected=[bottom.reduce((a,b)=>a.y<b.y?a:b),...(["x","z"] as const).flatMap(axis=>[bottom.reduce((a,b)=>a[axis]<b[axis]?a:b),bottom.reduce((a,b)=>a[axis]>b[axis]?a:b)])];
      return {foot:f.foot,local:selected.map(p=>f.foot.worldToLocal(p.clone()))};
    });
  }
  /** Stable point indices let audits distinguish rolling around the heel/toe from sliding. */
  contactPoints(){return this.soles.map(({foot,local})=>local.map(p=>foot.localToWorld(p.clone())));}
  positions(){return this.contactPoints().map(points=>points.reduce((a,b)=>a.y<b.y?a:b));}

  apply(root:THREE.Object3D,floorAt:(point:THREE.Vector3)=>number,delta:number){
    root.updateMatrixWorld(true);
    const positions=this.positions();if(!positions.length)return;
    const error=Math.max(...positions.map(p=>floorAt(p)-p.y));
    const dt=Math.max(0,Math.min(delta,1/30));
    // Correct penetration promptly, settle downward more gently, and keep
    // either direction bounded even after a delayed frame or a floor change.
    const correction=THREE.MathUtils.damp(0,error,error>0?60:22,dt);
    root.position.y+=THREE.MathUtils.clamp(correction,-1.5*dt,1.5*dt);
    root.updateMatrixWorld(true);
  }
}

export function floorHeight(environment:THREE.Object3D|null,point:THREE.Vector3){
  if(!environment)return -.605;
  const ray=new THREE.Raycaster(new THREE.Vector3(point.x,.2,point.z),new THREE.Vector3(0,-1,0),0,3);
  const hit=ray.intersectObject(environment,true).find(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.5);
  return hit?.point.y??-.605;
}
