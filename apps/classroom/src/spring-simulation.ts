import type * as THREE from "three";

/** Spring-bone drag is applied per update, so use a fixed physics cadence.
 * Bound catch-up after a suspended tab just like the main pose clock.
 */
export class SpringSimulation {
  private remainder = 0;
  private poses: {bone: THREE.Object3D; previous: THREE.Quaternion; current: THREE.Quaternion}[];
  constructor(bones: Iterable<THREE.Object3D> = []) {
    this.poses = [...new Set(bones)].map(bone=>({bone,previous:bone.quaternion.clone(),current:bone.quaternion.clone()}));
  }
  update(delta: number, step: (delta: number) => void) {
    const interval = 1 / 60;
    // Presentation must never feed interpolated rotations back into the solver.
    for (const pose of this.poses) pose.bone.quaternion.copy(pose.current);
    this.remainder += Math.max(0, Math.min(delta, 1 / 30));
    while (this.remainder + 1e-10 >= interval) {
      for (const pose of this.poses) pose.previous.copy(pose.current);
      step(interval);
      for (const pose of this.poses) pose.current.copy(pose.bone.quaternion);
      this.remainder = Math.max(0, this.remainder - interval);
    }
    const alpha = this.remainder / interval;
    for (const pose of this.poses) pose.bone.quaternion.copy(pose.previous).slerp(pose.current,alpha);
  }
}
