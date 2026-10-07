import * as THREE from "three";

export const CAMERA_HOLD_SECONDS = 10;
// A wide front shot covers crossings; the oblique shots frame each teaching lane.
export const CLASSROOM_CAMERAS = [
  { id: "front", position: [-.8, 2.5, 8.9], target: [-.85, 1.85, 0], bias: .08 },
  { id: "right-front", position: [-.95, 2.5, 6.7], target: [-2.05, 1.85, 0], bias: 0 },
  { id: "left-front", position: [-2.5, 2.5, 7.3], target: [-.4, 1.85, 0], bias: .01 },
] as const;
export type ClassroomCameraId = typeof CLASSROOM_CAMERAS[number]["id"];
export function applyClassroomCamera(camera: THREE.PerspectiveCamera, id: ClassroomCameraId) {
  const preset = CLASSROOM_CAMERAS.find(item => item.id === id)!;
  camera.position.set(preset.position[0],preset.position[1],preset.position[2]); camera.lookAt(preset.target[0],preset.target[1],preset.target[2]); camera.updateMatrixWorld(true);
}
function projected(box: THREE.Box3, camera: THREE.PerspectiveCamera) {
  const points = [box.min.x,box.max.x].flatMap(x => [box.min.y,box.max.y].flatMap(y => [box.min.z,box.max.z].map(z => new THREE.Vector3(x,y,z).project(camera))));
  return { left: Math.min(...points.map(p=>p.x)), right: Math.max(...points.map(p=>p.x)), top: Math.max(...points.map(p=>p.y)), bottom: Math.min(...points.map(p=>p.y)) };
}
export function selectClassroomCamera(aspect: number, teacher: THREE.Box3, material: THREE.Box3, current: ClassroomCameraId, elapsed: number, travelX = 0): ClassroomCameraId {
  if (elapsed < CAMERA_HOLD_SECONDS) return current;
  const probe = new THREE.PerspectiveCamera(35,aspect,.1,30);
  // Sample the coming crossing, not a union box: a union would count empty space as occlusion.
  const ahead=THREE.MathUtils.clamp(travelX,-.95*CAMERA_HOLD_SECONDS,.95*CAMERA_HOLD_SECONDS);
  const teachers=[0,.25,.5,.75,1].map(t=>teacher.clone().translate(new THREE.Vector3(ahead*t,0,0)));
  const scores = CLASSROOM_CAMERAS.map(preset => {
    applyClassroomCamera(probe,preset.id);
    const m = projected(material,probe);
    const crop = Math.max(0,-.96-m.left)+Math.max(0,m.right-.96)+Math.max(0,m.top-.96)+Math.max(0,-.96-m.bottom);
    const samples=teachers.map(teacher=>{
      const t=projected(teacher,probe);
      const overlap = Math.max(0,Math.min(t.right,m.right)-Math.max(t.left,m.left))*Math.max(0,Math.min(t.top,m.top)-Math.max(t.bottom,m.bottom));
      const teacherCrop = Math.max(0,-.96-t.left)+Math.max(0,t.right-.96)+Math.max(0,t.top-.96);
      const occlusion = overlap / Math.max(.001,(m.right-m.left)*(m.top-m.bottom));
      return occlusion*10+teacherCrop*30;
    });
    return { id: preset.id, score: Math.max(...samples)+crop*30+preset.bias+(preset.id===current ? -.015 : 0) };
  });
  scores.sort((a,b)=>a.score-b.score);
  return scores[0]!.id;
}

/** A lens adjustment preserves the fixed camera position and the cut cooldown.
 * Anticipate two seconds of travel so the lens opens before the teacher reaches the edge.
 */
export class ClassroomLens {
  private value = 35;
  private velocity = 0;
  update(camera: THREE.PerspectiveCamera, teacherX: number, destinationX: number, delta: number) {
    const aheadX=teacherX+THREE.MathUtils.clamp(destinationX-teacherX,-2.3,2.3);
    const teacher = new THREE.Box3(
      new THREE.Vector3(Math.min(teacherX,aheadX)-.85,1,.35),
      new THREE.Vector3(Math.max(teacherX,aheadX)+.85,3.1,1.2),
    );
    const board=new THREE.Box3(new THREE.Vector3(-3.9,.7,-.25),new THREE.Vector3(.95,3.45,0));
    const frames=[projected(teacher,camera),projected(board,camera)];
    const extent=Math.max(...frames.flatMap(frame=>[Math.abs(frame.left),Math.abs(frame.right),Math.abs(frame.top),Math.abs(frame.bottom)]));
    const required=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*extent/.92));
    const target=Math.max(35,required),dt=THREE.MathUtils.clamp(delta,0,1/30),omega=5,decay=Math.exp(-omega*dt);
    const error=this.value-target, impulse=this.velocity+omega*error;
    const next=target+(error+impulse*dt)*decay;
    this.velocity=THREE.MathUtils.clamp((this.velocity-omega*impulse*dt)*decay,-12,12);
    this.value+=THREE.MathUtils.clamp(next-this.value,-12*dt,12*dt);
    return this.value;
  }
}
