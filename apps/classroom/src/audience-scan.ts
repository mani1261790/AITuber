import { MathUtils } from "three";

/** Infrequent gaze changes with a dwell between them, not a periodic head sway.
 * The clock survives speech action/unit boundaries. Silence and board focus
 * return gently to centre; the next look starts only after another dwell. */
export class AudienceScan {
  private angle=0;
  private from=0;
  private goal=0;
  private age=0;
  private duration=2;
  private holding=5;
  private enabled=false;
  constructor(private seed=Math.floor(Math.random()*0xffffffff)) {}
  private random(){this.seed=(1664525*this.seed+1013904223)>>>0;return this.seed/0x100000000;}
  update(delta:number,enabled:boolean){
    const dt=MathUtils.clamp(delta,0,1/30);
    if(enabled!==this.enabled){
      this.enabled=enabled;this.holding=5+this.random()*3;
      this.from=this.angle;this.goal=0;this.age=0;this.duration=2;
    }
    if(this.age<this.duration){
      this.age=Math.min(this.duration,this.age+dt);
      this.angle=MathUtils.lerp(this.from,this.goal,MathUtils.smootherstep(this.age/this.duration,0,1));
    }else if(enabled){
      this.holding-=dt;
      if(this.holding<=0){
        this.from=this.angle;
        // Often return to the centre; side choices and dwell lengths are independent.
        const centre=Math.abs(this.angle)>.03 && this.random()<.75;
        this.goal=centre?0:(this.random()<.5?-1:1)*(.14+this.random()*.08);
        this.age=0;this.duration=1.8+this.random()*.8;this.holding=6+this.random()*4;
      }
    }
    return this.angle;
  }
}
