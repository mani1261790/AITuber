import * as THREE from "three";

export const CAMERA_HOLD_SECONDS = 10;
// A wide front shot covers crossings; the oblique shots frame each teaching lane.
export const CLASSROOM_CAMERAS = [
  { id: "front", position: [-.8, 2.5, 7.5], target: [-.85, 1.85, 0], bias: .08 },
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
export function selectClassroomCamera(aspect: number, teacher: THREE.Box3, material: THREE.Box3, current: ClassroomCameraId, elapsed: number): ClassroomCameraId {
  if (elapsed < CAMERA_HOLD_SECONDS) return current;
  const probe = new THREE.PerspectiveCamera(35,aspect,.1,30);
  const scores = CLASSROOM_CAMERAS.map(preset => {
    applyClassroomCamera(probe,preset.id);
    const t = projected(teacher,probe), m = projected(material,probe);
    const overlap = Math.max(0,Math.min(t.right,m.right)-Math.max(t.left,m.left))*Math.max(0,Math.min(t.top,m.top)-Math.max(t.bottom,m.bottom));
    const crop = Math.max(0,-.96-m.left)+Math.max(0,m.right-.96)+Math.max(0,m.top-.96)+Math.max(0,-.96-m.bottom);
    const teacherCrop = Math.max(0,-.96-t.left)+Math.max(0,t.right-.96)+Math.max(0,t.top-.96);
    return { id: preset.id, score: overlap*10+crop*30+teacherCrop*30+preset.bias+(preset.id===current ? -.015 : 0) };
  });
  scores.sort((a,b)=>a.score-b.score);
  return scores[0]!.id;
}
