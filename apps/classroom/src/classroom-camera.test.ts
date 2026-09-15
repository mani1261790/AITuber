import { expect, it } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { CAMERA_HOLD_SECONDS, CLASSROOM_CAMERAS, applyClassroomCamera, selectClassroomCamera } from "./classroom-camera.ts";
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
