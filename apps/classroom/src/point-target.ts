import { Vector3 } from "three";

/** Critically damped target tracking retains velocity when the focus changes. */
export class PointTarget {
  readonly position = new Vector3();
  private velocity = new Vector3();
  reset(target: Vector3) { this.position.copy(target); this.velocity.set(0,0,0); }
  update(target: Vector3, delta: number) {
    const dt=Math.max(0,Math.min(delta,1/30)),omega=8,decay=Math.exp(-omega*dt);
    const error=this.position.clone().sub(target);
    const impulse=this.velocity.clone().addScaledVector(error,omega);
    this.position.copy(target).add(error.addScaledVector(impulse,dt).multiplyScalar(decay));
    this.velocity.addScaledVector(impulse,-omega*dt).multiplyScalar(decay);
    return this.position;
  }
}
