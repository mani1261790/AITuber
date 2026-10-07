import type { Vector3 } from "three";

/** Briefly introduce the focus, rest during a long TTS wait, then indicate once with speech. */
export class PointingCue {
  private key = "";
  private age = 0;
  private commandId: string | undefined;
  private speechStarted = false;
  update(delta: number, target: Vector3 | null, speaking: boolean, commandId?: string) {
    const key = target ? target.toArray().map(n=>n.toFixed(2)).join(":") : "";
    // Only an explicit point_at command renews an unchanged focus. The later
    // speak action omits this id, so TTS waits and breaths retain cue history.
    if(key!==this.key || (commandId !== undefined && commandId !== this.commandId)){
      this.key=key;this.age=0;this.speechStarted=false;
    }
    if(!target)this.commandId=undefined;
    else if(commandId !== undefined)this.commandId=commandId;
    if(!target)return false;
    if(speaking && !this.speechStarted){this.speechStarted=true;this.age=0;}
    this.age+=Math.max(0,delta);
    return this.age<3.2;
  }
}
