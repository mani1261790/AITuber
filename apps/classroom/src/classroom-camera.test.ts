import { expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { CAMERA_HOLD_SECONDS, selectClassroomCamera } from "./classroom-camera.ts";
const board = new Box3(new Vector3(-3.9,.7,-.25),new Vector3(.95,3.45,0));
it("holds the current shot even when a different angle becomes preferable",()=>{
 const teacher=new Box3(new Vector3(-1,0,.5),new Vector3(0,3,1));
 expect(selectClassroomCamera(16/9,teacher,board,"left-front",CAMERA_HOLD_SECONDS-.1)).toBe("left-front");
});
it("selects the opposite oblique shot when the presenter covers the material edge",()=>{
 const teacher=new Box3(new Vector3(0,0,.5),new Vector3(1,3,1));
 expect(selectClassroomCamera(16/9,teacher,board,"front",11)).toBe("left-front");
 const leftTeacher=new Box3(new Vector3(-4,0,.5),new Vector3(-3,3,1));
 expect(selectClassroomCamera(16/9,leftTeacher,board,"front",11)).toBe("right-front");
});
