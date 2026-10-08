import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

type Contact = { pivot: THREE.Vector3 | null; pivotOffset: THREE.Vector3; releaseAge: number; releaseWeight: number; reason: string; orientation: THREE.Quaternion; rotationWeight: number; anchor: THREE.Vector3; weight: number; planted: boolean; cooldown: number; previousZ: number | null; velocity: number; clearance: number };
/** Horizontal support-foot locking after pose blending, before humanoid retargeting. */
export class FootContact {
  private contacts: Contact[] = [0,1].map(()=>({pivot:null,pivotOffset:new THREE.Vector3(),releaseAge:1,releaseWeight:0,reason:"initial",orientation:new THREE.Quaternion(),rotationWeight:0,anchor:new THREE.Vector3(),weight:0,planted:false,cooldown:0,previousZ:null,velocity:0,clearance:0}));
  constructor(private vrm: VRM) {}
  private soles: THREE.Vector3[][] = [];
  setSolePoints(worldPoints: THREE.Vector3[][]) {
    this.vrm.scene.updateMatrixWorld(true);
    this.soles=(["leftFoot","rightFoot"] as const).map((name,i)=>{
      const foot=this.vrm.humanoid.getNormalizedBoneNode(name);
      return foot ? (worldPoints[i]??[]).map(point=>foot.worldToLocal(point.clone())) : [];
    });
  }
  private reachRatios = [0, 0];
  private pelvisDrop = 0;
  private wasTurning = false;
  get supportState() { return this.contacts.map(({planted,weight,velocity,reason,clearance},i)=>({planted,weight,velocity,reason,clearance,pelvisDrop:this.pelvisDrop,reachRatio:this.reachRatios[i]})); }
  apply(delta: number, moving: boolean, turning = false) {
    const dt=Math.min(Math.max(delta,0),1/30), root=this.vrm.scene;
    if(this.wasTurning && !turning) {
      for(const state of this.contacts){state.planted=false;state.cooldown=.2;state.reason="phase";state.releaseAge=1;}
    }
    this.wasTurning=turning;
    root.updateMatrixWorld(true);
    const legs=(["left","right"] as const).map(side=>({
      upper:this.vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`),
      lower:this.vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`),
      foot:this.vrm.humanoid.getNormalizedBoneNode(`${side}Foot`),
    }));
    if(legs.some(leg=>!leg.upper||!leg.lower||!leg.foot))return;
    const positions=legs.map(leg=>leg.foot!.getWorldPosition(new THREE.Vector3()));
    const floor=Math.min(...positions.map(p=>p.y));
    const soleHeights=legs.map((leg,i)=>this.soles[i]?.length
      ? Math.min(...this.soles[i]!.map(point=>leg.foot!.localToWorld(point.clone()).y)) : positions[i]!.y);
    const soleFloor=Math.min(...soleHeights);
    const hipPositions=legs.map(leg=>leg.upper!.getWorldPosition(new THREE.Vector3()));
    const hipCenter=hipPositions[0]!.clone().add(hipPositions[1]!).multiplyScalar(.5);
    const lateral=new THREE.Vector3(1,0,0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    const corrections: {upper:THREE.Object3D;lower:THREE.Object3D;foot:THREE.Object3D;goal:THREE.Vector3;orientation:THREE.Quaternion;length:number;index:number}[]=[];
    legs.forEach((leg,i)=>{
      const {upper,lower,foot}=leg;if(!upper||!lower||!foot)return;
      const p=positions[i]!,state=this.contacts[i]!;
      const hip=upper.getWorldPosition(new THREE.Vector3()),knee=lower.getWorldPosition(new THREE.Vector3());
      const length=hip.distanceTo(knee)+knee.distanceTo(p);
      state.cooldown=Math.max(0,state.cooldown-dt);
      const localZ=root.worldToLocal(p.clone()).z*Math.abs(root.scale.z);
      const velocity=state.previousZ===null?0:(localZ-state.previousZ)/Math.max(dt,.001);
      state.previousZ=localZ;state.velocity=THREE.MathUtils.damp(state.velocity,velocity,18,dt);
      const swinging=!turning&&state.velocity>.08;
      const lift=p.y-floor;
      // Pivot steps lift less than a forward stride. Release before the
      // planted ankle is dragged around the body by the continuing turn.
      const liftLimit = turning ? .045 : .09;
      const side=Math.sign(hip.clone().sub(hipCenter).dot(lateral))||1;
      // Release a world-space anchor before turning carries it into the opposite leg's lane.
      const stanceSafe=(point:THREE.Vector3)=>side*point.clone().sub(hipCenter).dot(lateral)>length*.06;
      const supportPosition=()=>{
        const support=state.anchor.clone();
        if(turning && state.pivot)support.add(state.pivotOffset).sub(foot.localToWorld(state.pivot.clone()).sub(p));
        return support;
      };
      const crossing=turning&&(!stanceSafe(state.anchor)||side*supportPosition().sub(hipCenter).dot(lateral)<length*.02);
      const drift=Math.hypot(p.x-state.anchor.x,p.z-state.anchor.z);
      if(state.planted&&(!moving||swinging||lift>liftLimit||crossing||drift>length*.28)) {state.reason=!moving?"stopped":swinging?"swing":lift>liftLimit?"lift":crossing?"crossing":"drift";state.planted=false;state.cooldown=.15;if(moving){state.releaseAge=0;state.releaseWeight=state.weight;}}
      if(!state.planted&&state.weight<.03&&moving&&!swinging&&lift<.025&&state.cooldown===0&&(!turning||stanceSafe(p))){state.anchor.copy(p);foot.getWorldQuaternion(state.orientation);state.planted=true;
        state.pivot=null;
        // Prefer a toe pivot among grounded sole points; when the toe is raised,
        // use the grounded heel instead. Keep the authored ankle rotation.
        if(this.soles[i]?.length){
          const samples=this.soles[i]!.map(point=>({point,height:foot.localToWorld(point.clone()).y}));
          const lowest=Math.min(...samples.map(sample=>sample.height));
          state.pivot=samples.filter(sample=>sample.height<=lowest+.015)
            .reduce((front,sample)=>sample.point.z>front.point.z?sample:front).point.clone();
          state.pivotOffset.copy(foot.localToWorld(state.pivot.clone())).sub(p);
        }
      }
      // Once travel stops, settle the planted foot into the idle stance rather
      // than releasing the entire horizontal correction within a few frames.
      const releaseRate = moving ? 22 : 6;
      // During toe-off, preserve the support correction initially, then release
      // it with zero endpoint velocity while lifting into the authored swing.
      state.releaseAge += dt;
      // A pivot unwinds an anchor displaced by body rotation; give that larger
      // correction time to unwind without accelerating the foot into a kick.
      // Walking toe-off must finish before mid-swing; retaining the anchor
      // for most of a step drags the ankle back and forces a deep pelvis drop.
      const releaseDuration = turning ? .4 : .16;
      const releaseProgress = Math.min(1,state.releaseAge/releaseDuration);
      state.weight = releaseProgress < 1 && !state.planted
        ? state.releaseWeight * Math.max(0,1-THREE.MathUtils.smootherstep(releaseProgress,0,1))
        : THREE.MathUtils.damp(state.weight,state.planted?1:0,releaseRate,dt);
      // Keep most of the stance orientation: ankle-only locking still lets the sole skate.
      // Retain some authored roll and release into swing; pivots keep their recorded rotation.
      if(turning)foot.getWorldQuaternion(state.orientation);
      state.rotationWeight=THREE.MathUtils.damp(state.rotationWeight,state.planted && !turning && this.soles[i]?.length ? .8 : 0,moving ? 16 : 6,dt);
      // Retargeting locomotion onto a model wearing heels can leave the swing toe on the
      // floor. Add only missing clearance, proportional to forward swing speed;
      // fade out before stance instead of lifting a planted support foot.
      const swing = moving && !turning ? THREE.MathUtils.smoothstep(state.velocity, .08, .65) : 0;
      const releaseLift = releaseProgress < 1 && !state.planted && moving && !turning ? Math.sin(Math.PI*releaseProgress)**2 : 0;
      // Measure the shoe rather than the ankle: heels otherwise trigger a large
      // unnecessary lift on every stride and keep both knees visibly crouched.
      const needed = Math.max(0, length * .025 - (soleHeights[i]!-soleFloor)) * Math.max(swing,releaseLift);
      state.clearance = THREE.MathUtils.damp(state.clearance, needed, 16, dt);
      if(state.weight<.001 && state.rotationWeight<.0001 && state.clearance<.0001 && this.pelvisDrop<.0001)return;
      const goal=p.clone().lerp(supportPosition(),state.weight);goal.y=p.y+state.clearance;
      const authored=foot.getWorldQuaternion(new THREE.Quaternion());
      const orientation=authored.clone().slerp(state.orientation,state.rotationWeight);
      const points=this.soles[i],scale=foot.getWorldScale(new THREE.Vector3());
      // Keep the grounded shoe point fixed as the blended ankle rolls.
      // An ankle-only anchor lets the toe slide during release even with smooth rotations.
      if(!turning && state.pivot){
        const offset=state.pivot.clone().multiply(scale).applyQuaternion(orientation);
        goal.x+=(state.pivotOffset.x-offset.x)*state.weight;
        goal.z+=(state.pivotOffset.z-offset.z)*state.weight;
      }
      if(points?.length){
        goal.y+=soleHeightOffset(points,scale,authored)-soleHeightOffset(points,scale,orientation);
      }
      corrections.push({upper,lower,foot,goal,orientation,length,index:i});
    });
    const hips=this.vrm.humanoid.getNormalizedBoneNode("hips");
    if(hips){
      let desired=0;
      for(const {upper,goal,length,index} of corrections){
        // Keep supporting the IK reach while the foot anchor fades out. Dropping
        // the pelvis correction at the planted flag boundary lifts the whole
        // body abruptly even though the foot is still almost fully constrained.
        if(this.contacts[index]!.weight<.001)continue;
        const hip=upper.getWorldPosition(new THREE.Vector3());
        const horizontal=Math.hypot(hip.x-goal.x,hip.z-goal.z);
        // A 1% reach reserve forces even a straight support leg into ~16 degrees
        // of flexion. Keep a small non-locking reserve without adding a squat.
        const vertical=Math.sqrt(Math.max(0,(length*.998)**2-horizontal**2));
        desired=Math.max(desired,Math.min(length*(turning?.08:.018),Math.max(0,hip.y-goal.y-vertical)));
      }
      // Walking support must not pull the pelvis into a deep squat at every toe-off.
      // A small reach allowance supports contact; the leg solver bounds excess reach.
      // Pivot steps retain their larger support range.
      // Reach support responds promptly; standing back up should not pop the torso.
      const targetDrop=moving?desired:0;
      this.pelvisDrop=THREE.MathUtils.damp(this.pelvisDrop,targetDrop,targetDrop<this.pelvisDrop?8:18,dt);
      const scale=hips.parent!.getWorldScale(new THREE.Vector3()).y;
      hips.position.y-=this.pelvisDrop/Math.max(Math.abs(scale),.0001);
      root.updateMatrixWorld(true);
    }
    for(const {upper,lower,foot,goal,orientation,length,index} of corrections){
      this.reachRatios[index]=upper.getWorldPosition(new THREE.Vector3()).distanceTo(goal)/Math.max(length,.0001);
      solveLeg(root,upper,lower,foot,goal,turning?1:.75);
      foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    }
  }
}

/** Preserve ankle orientation and knee bend direction while placing the support foot. */
export function solveLeg(root: THREE.Object3D, upper: THREE.Object3D, lower: THREE.Object3D, foot: THREE.Object3D, goal: THREE.Vector3, kneeTurnout = 1) {
  root.updateMatrixWorld(true);
  const hip=upper.getWorldPosition(new THREE.Vector3()),knee=lower.getWorldPosition(new THREE.Vector3()),ankle=foot.getWorldPosition(new THREE.Vector3());
  const orientation=foot.getWorldQuaternion(new THREE.Quaternion());
  const a=hip.distanceTo(knee),b=knee.distanceTo(ankle);
  if(a<1e-5||b<1e-5)return;
  const direction=goal.clone().sub(hip),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(a-b)+.0001,(a+b)*.999);
  direction.normalize();
  // Preserve the authored bend plane. Only a near-straight source leg needs
  // a forward fallback; always using that fallback erases natural knee turnout
  // even when the ankle goal is exactly its original position.
  const originalAxis=ankle.clone().sub(hip).normalize();
  const authoredPole=knee.clone().sub(hip);
  authoredPole.addScaledVector(originalAxis,-authoredPole.dot(originalAxis));
  const stability=THREE.MathUtils.smoothstep(authoredPole.length()/(a+b),.015,.08);
  authoredPole.addScaledVector(direction,-authoredPole.dot(direction));
  const pole=new THREE.Vector3(0,0,1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
  pole.addScaledVector(direction,-pole.dot(direction));
  if(pole.lengthSq()<1e-6){pole.set(1,0,0);pole.addScaledVector(direction,-pole.dot(direction));}
  pole.normalize();
  if(authoredPole.lengthSq()>1e-8){
    const rotation=new THREE.Quaternion().setFromUnitVectors(pole,authoredPole.normalize());
    pole.applyQuaternion(new THREE.Quaternion().slerp(rotation,stability*kneeTurnout));
  }
  const along=(a*a-b*b+distance*distance)/(2*distance);
  const kneeGoal=hip.clone().addScaledVector(direction,along).addScaledVector(pole,Math.sqrt(Math.max(0,a*a-along*along)));
  const ankleGoal=hip.clone().addScaledVector(direction,distance);
  for(const [joint,child,target] of [[upper,lower,kneeGoal],[lower,foot,ankleGoal]] as const){
    root.updateMatrixWorld(true);
    const origin=joint.getWorldPosition(new THREE.Vector3());
    const rotation=new THREE.Quaternion().setFromUnitVectors(child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(),target.clone().sub(origin).normalize());
    const parent=joint.parent!.getWorldQuaternion(new THREE.Quaternion());
    joint.quaternion.premultiply(parent.clone().invert().multiply(rotation).multiply(parent));
  }
  root.updateMatrixWorld(true);
  foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
}

/** Lowest calibrated sole point relative to the ankle after scaling and rotation. */
export function soleHeightOffset(points: THREE.Vector3[], scale: THREE.Vector3, orientation: THREE.Quaternion) {
  return Math.min(...points.map(point=>point.clone().multiply(scale).applyQuaternion(orientation).y));
}
