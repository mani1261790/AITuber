import * as THREE from "three";

/** Apply every generated pose through one persistent, frame-rate independent output stage.
 * Keep the mixer pose separate: Three may skip writing constant tracks on later frames.
 */
/** A spring stores motion as well as pose, so interrupted gestures do not reverse instantly. */
export class PoseTransition {
  private poses = new Map<THREE.Object3D, {
    rotation: THREE.Quaternion; position: THREE.Vector3;
    angularVelocity: THREE.Vector3; velocity: THREE.Vector3;
  }>();
  constructor(bones: Iterable<THREE.Object3D>, private response = 10, private angularSpeed: (bone: THREE.Object3D) => number = () => 5, private coupledBones: THREE.Object3D[][] = []) {
    for (const bone of bones) this.poses.set(bone, {
      rotation: bone.quaternion.clone(), position: bone.position.clone(),
      angularVelocity: new THREE.Vector3(), velocity: new THREE.Vector3(),
    });
  }
  apply(delta: number) {
    const dt = Math.min(Math.max(delta, 0), 1 / 30);
    // A solved limb is a coordinated pose: limiting its joints independently
    // can move the endpoint faster than the IK trajectory it was meant to bound.
    const coupled = new Set<THREE.Object3D>();
    if (!Number.isFinite(this.response)) for (const group of this.coupledBones) {
      let progress = dt > 0 ? 1 : 0;
      for (const bone of group) {
        const pose=this.poses.get(bone); if (!pose) continue;
        const angle=pose.rotation.angleTo(bone.quaternion), distance=pose.position.distanceTo(bone.position);
        if (angle > 1e-9) progress=Math.min(progress,this.angularSpeed(bone)*dt/angle);
        if (distance > 1e-9) progress=Math.min(progress,1.5*dt/distance);
      }
      for (const bone of group) {
        const pose=this.poses.get(bone); if (!pose) continue;
        pose.rotation.slerp(bone.quaternion,progress);pose.position.lerp(bone.position,progress);
        bone.quaternion.copy(pose.rotation);bone.position.copy(pose.position);coupled.add(bone);
      }
    }
    for (const [bone, pose] of this.poses) {
      if (coupled.has(bone)) continue;
      if (dt > 0) {
        // Quaternion logarithm in parent space takes the shortest rotation, including q / -q.
        const difference = bone.quaternion.clone().multiply(pose.rotation.clone().invert()).normalize();
        if (difference.w < 0) difference.set(-difference.x,-difference.y,-difference.z,-difference.w);
        const axis = new THREE.Vector3(difference.x,difference.y,difference.z);
        const length = axis.length();
        const angle = 2 * Math.atan2(length, difference.w);
        const error = axis.multiplyScalar(length > 1e-9 ? -angle / length : 0);
        const step = this.advance(error, pose.angularVelocity, dt, this.angularSpeed(bone));
        const stepAngle = step.length();
        if (stepAngle > 1e-9) pose.rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(step.divideScalar(stepAngle),stepAngle)).normalize();
        pose.position.add(this.advance(pose.position.clone().sub(bone.position),pose.velocity,dt,1.5));
      }
      bone.quaternion.copy(pose.rotation);
      bone.position.copy(pose.position);
    }
  }
  private advance(error: THREE.Vector3, velocity: THREE.Vector3, dt: number, maxSpeed: number) {
    // The post-IK stage only bounds displacement: filtering it again would loosen foot contact.
    if (!Number.isFinite(this.response)) return error.negate().clampLength(0,maxSpeed*dt);
    const omega = this.response * 2, decay = Math.exp(-omega*dt);
    const impulse = velocity.clone().addScaledVector(error,omega);
    const step = error.clone().addScaledVector(impulse,dt).multiplyScalar(decay).sub(error);
    velocity.addScaledVector(impulse,-omega*dt).multiplyScalar(decay).clampLength(0,maxSpeed);
    return step.clampLength(0,maxSpeed*dt);
  }
}

/** Show target height in the arm pose, even when the board is several arm lengths away. */
export function pointingHandGoal(shoulder: THREE.Vector3, target: THREE.Vector3, reach: number, lowReach = reach) {
  const horizontal = target.clone().sub(shoulder).setY(0).normalize();
  const height = THREE.MathUtils.clamp(target.y - shoulder.y, -reach * .9, reach * .85);
  // Extend low gestures away from clothing without lifting their pointing height.
  const lowAmount = THREE.MathUtils.smoothstep(shoulder.y-target.y, reach*.45, reach*.9);
  const distance = THREE.MathUtils.lerp(reach, Math.max(reach,lowReach), lowAmount);
  return shoulder.clone().addScaledVector(horizontal, Math.sqrt(distance * distance - height * height)).add(new THREE.Vector3(0, height, 0));
}

/** Keep the authored downward elbow preference unless it forces a sharply bent wrist.
 * The elbow can swivel on its reach circle without changing hand position or arm lengths.
 */
export function pointingElbowGoal(shoulder: THREE.Vector3, hand: THREE.Vector3, target: THREE.Vector3, upperLength: number, lowerLength: number, preference: THREE.Vector3) {
  const axis=hand.clone().sub(shoulder), reach=axis.length();
  axis.normalize();
  const along=(upperLength*upperLength-lowerLength*lowerLength+reach*reach)/(2*Math.max(reach,1e-6));
  const radius=Math.sqrt(Math.max(0,upperLength*upperLength-along*along));
  const center=shoulder.clone().addScaledVector(axis,along);
  const pole=preference.clone().addScaledVector(axis,-preference.dot(axis));
  if(pole.lengthSq()<1e-8) {
    pole.set(Math.abs(axis.x)<.8?1:0,Math.abs(axis.x)<.8?0:1,0);
    pole.addScaledVector(axis,-pole.dot(axis));
  }
  pole.normalize();
  const aim=target.clone().sub(hand).normalize();
  const ideal=aim.clone().negate().addScaledVector(axis,aim.dot(axis)).normalize();
  const elbow=(angle:number)=>center.clone().addScaledVector(pole.clone().applyAxisAngle(axis,angle),radius);
  const alignment=(angle:number)=>hand.clone().sub(elbow(angle)).normalize().dot(aim);
  if(alignment(0)>=Math.cos(.65) || ideal.lengthSq()<1e-8) return elbow(0);
  const swivel=Math.atan2(axis.dot(pole.clone().cross(ideal)),pole.dot(ideal));
  // Find the smallest swivel that relieves the wrist; use the best reachable pose otherwise.
  const threshold=Math.min(Math.cos(.65),alignment(swivel));
  let low=0,high=1;
  for(let i=0;i<16;i++) { const mid=(low+high)/2; if(alignment(mid*swivel)<threshold)low=mid;else high=mid; }
  let angle=high*swivel;
  // Raising a hand should not roll the elbow over the shoulder to straighten the wrist.
  if(hand.y>shoulder.y && elbow(angle).y>shoulder.y+.08){
    let low=0,high=1;
    for(let i=0;i<16;i++){const mid=(low+high)/2;if(elbow(angle*mid).y>shoulder.y+.08)high=mid;else low=mid;}
    angle*=low;
  }
  return elbow(angle);
}
