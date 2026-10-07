import { MathUtils } from "three";
/** Use the same standing pose for initial display and subsequent stage commands. */
export function stageStandingPose(position: "left" | "center" | "right" | undefined, pointing = false) {
  if (position === "left") return {x:-4.2,yaw:.26};
  if (position === "center" && !pointing) return {x:-.65,yaw:0};
  return {x:2.35,yaw:-.26};
}
export type TravelPhase = "idle" | "turn" | "walk" | "brake";
/** Turn clips and stage translation share one clock; never translate during a pivot. */
export class StageLocomotion {
  phase: TravelPhase = "idle";
  x: number; yaw: number; speed = 0;
  turnSign = 1; turnProgress = 0;
  private goal: number;
  private elapsed = 0;
  private startYaw = 0;
  private endYaw = 0;
  private duration = 1;
  private turnSegments = 1;
  private turnAngle = 0;
  private afterTurn: TravelPhase = "walk";
  private travelSign = 1;
  constructor(x:number,yaw:number){this.x=x;this.yaw=yaw;this.goal=x;}
  update(dt:number,goal:number,standYaw:number,leftDuration:number,rightDuration:number,rotationProgress: (progress:number,sign:number)=>number = progress=>MathUtils.smootherstep(progress,0,1)){
    dt = Math.min(Math.max(dt, 0), 1 / 30);
    const beginTurn=(yaw:number,after:TravelPhase)=>{
      const angle=Math.atan2(Math.sin(yaw-this.yaw),Math.cos(yaw-this.yaw));
      // A half turn needs two foot-placement cycles, not one 90-degree clip
      // stretched over the whole rotation. Keep ordinary audience turns single.
      this.turnSegments=Math.abs(angle)>Math.PI*.75?2:1;
      this.turnAngle=angle/this.turnSegments;
      this.startYaw=this.yaw;this.endYaw=this.yaw+this.turnAngle;this.elapsed=0;this.turnProgress=0;
      this.turnSign=Math.sign(angle)||1;this.duration=Math.max(.35,(angle>0?leftDuration:rightDuration)*Math.abs(this.turnAngle)/(Math.PI/2));
      this.afterTurn=after;this.phase=Math.abs(angle)<.035?after:"turn";this.speed=0;
    };
    const deceleration=1.3;
    const faceDestination=()=>{
      this.travelSign=Math.sign(this.goal-this.x)||this.travelSign;
      beginTurn(Math.abs(this.goal-this.x)<.001?standYaw:this.travelSign*Math.PI/2,Math.abs(this.goal-this.x)<.001?"idle":"walk");
    };
    if(Math.abs(goal-this.goal)>.025){
      this.goal=goal;
      if(this.phase==="walk" && this.speed>.01){
        // Preserve momentum. A reversal (or a new goal inside stopping distance)
        // must finish braking before a pivot; an extension can keep walking.
        const stoppingDistance=this.speed*this.speed/(2*deceleration)+this.speed*dt;
        if((goal-this.x)*this.travelSign<=stoppingDistance)this.phase="brake";
      }else if(this.phase!=="brake")faceDestination();
    }
    if(this.phase==="turn"){
      this.elapsed+=dt;this.turnProgress=Math.min(1,this.elapsed/this.duration);
      this.yaw=MathUtils.lerp(this.startYaw,this.endYaw,rotationProgress(this.turnProgress,this.turnSign));
      if(this.turnProgress>=1){
        if(this.turnSegments>1){
          this.turnSegments--;this.elapsed=0;this.startYaw=this.endYaw;this.endYaw+=this.turnAngle;
          // Keep the final sample this frame; next frame starts the new cycle
          // through the same persistent whole-body pose transition.
        }else{this.phase=this.afterTurn;this.speed=0;}
      }
    }else if(this.phase==="brake"){
      const before=this.speed;
      this.speed=Math.max(0,before-deceleration*dt);
      this.x+=this.travelSign*(before+this.speed)*.5*dt;
      if(this.speed===0)faceDestination();
    }else if(this.phase==="walk"){
      const distance=this.goal-this.x;
      const remaining=Math.abs(distance);
      // Reserve this frame's travel as well as the following stopping distance:
      // v * dt + v² / (2a) <= remaining. Rational form avoids cancellation near zero.
      const divisor=Math.sqrt((deceleration*dt)**2+2*deceleration*remaining)+deceleration*dt;
      const wanted=Math.min(1.4,divisor>0?2*deceleration*remaining/divisor:0);
      // Smooth acceleration, but never lag behind the braking envelope.
      // Otherwise the root reaches its goal while the walk still has speed.
      this.speed=Math.min(wanted,MathUtils.damp(this.speed,wanted,6,dt));
      const step=Math.min(Math.abs(distance),this.speed*dt);this.x+=Math.sign(distance)*step;
      if(step >= Math.abs(distance)){beginTurn(standYaw,"idle");}
    }else{this.speed=0;}
    return this;
  }
}
