import { expect, it } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { ClassroomLens, CAMERA_HOLD_SECONDS, CLASSROOM_CAMERAS, applyClassroomCamera, selectClassroomCamera } from "./classroom-camera.ts";
const board = new Box3(new Vector3(-3.9,.7,-.25),new Vector3(.95,3.45,0));
it("holds the current shot even when a different angle becomes preferable",()=>{
 const teacher=new Box3(new Vector3(-1,0,.5),new Vector3(0,3,1));
 expect(selectClassroomCamera(16/9,teacher,board,"left-front",CAMERA_HOLD_SECONDS-.1)).toBe("left-front");
});
it("frames the occupied teaching lane instead of the empty opposite wall",()=>{
 const teacher=new Box3(new Vector3(1.7,0,.5),new Vector3(3.1,3,1));
 expect(selectClassroomCamera(16/9,teacher,board,"front",11)).toBe("left-front");
 const leftTeacher=new Box3(new Vector3(-4.9,0,.5),new Vector3(-3.6,3,1));
 expect(selectClassroomCamera(16/9,leftTeacher,board,"front",11)).toBe("right-front");
});

it("keeps the complete teaching surface inside all three shots", () => {
 for (const preset of CLASSROOM_CAMERAS) {
  const camera = new PerspectiveCamera(35,16/9,.1,30);
  applyClassroomCamera(camera,preset.id);
  for (const x of [board.min.x,board.max.x]) for (const y of [board.min.y,board.max.y]) for (const z of [board.min.z,board.max.z]) {
   const point = new Vector3(x,y,z).project(camera);
   expect(Math.abs(point.x)).toBeLessThan(.98);
   expect(Math.abs(point.y)).toBeLessThan(.98);
  }
 }
});


it("keeps both teaching lanes inside the front shot while its cut cooldown is active", () => {
 const camera=new PerspectiveCamera(35,16/9,.1,30);
 applyClassroomCamera(camera,"front");
 // Upper-body and hand envelope: a feet crop is intentional, a shoulder crop is not.
 for(const x of [-4.95,-3.4,1.5,3.1]) for(const y of [1.1,3.1]) for(const z of [.35,1.1]) {
  const point=new Vector3(x,y,z).project(camera);
  expect(Math.abs(point.x)).toBeLessThan(.96);
  expect(Math.abs(point.y)).toBeLessThan(.96);
 }
});


it("smoothly widens a held shot ahead of a crossing without moving or cutting the camera", () => {
 const camera=new PerspectiveCamera(35,16/9,.1,30),lens=new ClassroomLens();
 applyClassroomCamera(camera,"left-front");
 const position=camera.position.clone(),rotation=camera.quaternion.clone();
 for(let i=0;i<600;i++) {
  const x=2.35-6.55*Math.min(1,i/540),previous=camera.fov;
  camera.fov=lens.update(camera,x,-4.2,1/60);camera.updateProjectionMatrix();
  expect(Math.abs(camera.fov-previous)).toBeLessThanOrEqual(12/60+1e-8);
  for(const dx of [-.7,.7]) {
   const p=new Vector3(x+dx,2.5,1).project(camera);
   expect(Math.abs(p.x)).toBeLessThan(1);
  }
 }
 expect(camera.position.equals(position)).toBe(true);
 expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-6);
 const wide=camera.fov;
 applyClassroomCamera(camera,"right-front");
 for(let i=0;i<300;i++){camera.fov=lens.update(camera,-4.2,-4.2,1/60);camera.updateProjectionMatrix();}
 expect(camera.fov).toBeLessThan(wide);
});

it("frames the upcoming crossing for the whole cut hold without breaking the cooldown",()=>{
 for(const [x,destination,current] of [[2.35,-4.2,"left-front"],[-4.2,2.35,"right-front"]] as const){
  const teacher=new Box3(new Vector3(x-.5,1,.35),new Vector3(x+.5,3.1,1.1));
  expect(selectClassroomCamera(16/9,teacher,board,current,11,destination-x)).toBe("front");
  expect(selectClassroomCamera(16/9,teacher,board,current,9,destination-x)).toBe(current);
  expect(selectClassroomCamera(16/9,teacher,board,current,11,0)).toBe(current);
 }
});
