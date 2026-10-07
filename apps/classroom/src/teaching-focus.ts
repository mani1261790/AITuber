/** Look at a newly indicated detail before addressing the audience.
 * Speech gaps shorter than a phrase do not restart the board glance.
 */
export class TeachingFocus {
  private cue: string | undefined;
  private commandId: string | undefined;
  private age = 0;
  private silence = 0;
  private weight = 1;
  update(delta: number, cue: string | undefined, speaking: boolean, commandId?: string) {
    const dt = Math.min(Math.max(delta,0),1/30);
    if(cue !== this.cue || (commandId !== undefined && commandId !== this.commandId)) { this.cue=cue; this.age=0; }
    if(cue === undefined) this.commandId=undefined;
    else if(commandId !== undefined) this.commandId=commandId;
    this.age+=dt;
    this.silence=speaking?0:this.silence+dt;
    const target=this.age<1.4 || this.silence>.7 ? 1 : .15;
    this.weight+=(target-this.weight)*(1-Math.exp(-dt*3));
    return this.weight;
  }
}
