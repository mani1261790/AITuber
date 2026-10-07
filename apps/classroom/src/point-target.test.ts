import {expect,it} from "vitest";
import {Vector3} from "three";
import {PointTarget} from "./point-target.ts";
it("retains motion across a focus reversal and settles without overshoot from rest",()=>{
 const motion=new PointTarget(),high=new Vector3(0,2,0),low=new Vector3(0,-2,0);motion.reset(new Vector3());
 for(let i=0;i<12;i++)motion.update(high,1/60);
 const before=motion.position.clone(),dt=.00001;
 motion.update(high,dt);const velocity=motion.position.clone().sub(before).divideScalar(dt),atChange=motion.position.clone();
 motion.update(low,dt);const after=motion.position.clone().sub(atChange).divideScalar(dt);
 expect(after.distanceTo(velocity)).toBeLessThan(.01);
 for(let i=0;i<180;i++)motion.update(low,1/60);
 expect(motion.position.distanceTo(low)).toBeLessThan(.0001);
 motion.reset(new Vector3());let previous=0;
 for(let i=0;i<90;i++){motion.update(high,1/60);expect(motion.position.y).toBeGreaterThanOrEqual(previous);expect(motion.position.y).toBeLessThanOrEqual(2);previous=motion.position.y;}
});
it("matches frame rates and bounds delayed updates",()=>{
 const results=[30,60,120].map(fps=>{const m=new PointTarget();for(let i=0;i<fps;i++)m.update(new Vector3(1,2,3),1/fps);return m.position.clone();});
 expect(results[0]!.distanceTo(results[2]!)).toBeLessThan(1e-9);
 const a=new PointTarget(),b=new PointTarget(),target=new Vector3(1,2,3);a.update(target,3);b.update(target,1/30);expect(a.position.equals(b.position)).toBe(true);
 const before=a.position.clone();a.update(target,0);expect(a.position.distanceTo(before)).toBeLessThan(1e-9);
});
