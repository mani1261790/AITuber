import type { Vector3 } from "three";

/** Briefly introduce the focus, rest during a long TTS wait, then indicate once with speech. */
export class PointingCue {
  private key = "";
  private age = 0;
  private commandId: string | undefined;
  private speechStarted = false;
  private raisedAge = 0;
  private restRemaining = 0;
  update(delta: number, target: Vector3 | null, speaking: boolean, commandId?: string, hold = false) {
    const dt = Math.max(0, delta);
    this.restRemaining = Math.max(0, this.restRemaining - dt);
    const key = target ? target.toArray().map(n=>n.toFixed(2)).join(":") : "";
    // Only an explicit point_at command renews an unchanged focus. The later
    // speak action omits this id, so TTS waits and breaths retain cue history.
    if(key!==this.key || (commandId !== undefined && commandId !== this.commandId)){
      this.key=key;this.age=0;this.speechStarted=false;
    }
    if(!target)this.commandId=undefined;
    else if(commandId !== undefined)this.commandId=commandId;
    if(!target){this.raisedAge=0;return false;}
    if(!hold && speaking && !this.speechStarted){this.speechStarted=true;this.age=0;}
    this.age+=dt;
    // Authored text selects WHEN to point, not an unlimited arm hold. A changed
    // target must not extend a chain of adjacent cues indefinitely either.
    if(this.age>=3.2){
      if(hold && this.raisedAge>0)this.restRemaining=1.2;
      this.raisedAge=0;return false;
    }
    if(!hold){this.raisedAge=0;return true;}
    if(this.restRemaining>0)return false;
    this.raisedAge+=dt;
    if(this.raisedAge>=3.2){this.raisedAge=0;this.restRemaining=1.2;return false;}
    return true;
  }
}
