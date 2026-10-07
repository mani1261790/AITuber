import * as THREE from "three";

/** Match both joint angles and world-space foot placement when entering a gait.
 * Evaluate forward kinematics off-rig so phase selection never changes the rendered pose. */
export function closestWalkPhase(clip: THREE.AnimationClip, bones: THREE.Object3D[], samples = 48, feet: THREE.Object3D[] = []) {
  const byName = new Map(bones.map(bone=>[bone.name,bone]));
  const tracks = clip.tracks.flatMap(track=>{
    if(!track.name.endsWith(".quaternion"))return [];
    const bone=byName.get(track.name.slice(0,-11));
    return bone ? [{bone, sample:new THREE.QuaternionLinearInterpolant(track.times,track.values,4,new Float32Array(4))}] : [];
  });
  const positionTracks = clip.tracks.flatMap(track=>{
    if(!track.name.endsWith(".position"))return [];
    const bone=byName.get(track.name.slice(0,-9));
    return bone ? [{bone,sample:new THREE.LinearInterpolant(track.times,track.values,3,new Float32Array(3))}] : [];
  });
  if((!tracks.length && !positionTracks.length) || clip.duration<=0)return 0;
  const targets = feet.map(foot=>({foot,position:foot.getWorldPosition(new THREE.Vector3())}));
  let best=0, score=Infinity;
  const rotation=new THREE.Quaternion();
  for(let i=0;i<samples;i++){
    const time=i*clip.duration/samples;
    let error=0;
    const rotations=new Map<THREE.Object3D,THREE.Quaternion>();
    const positions=new Map(positionTracks.map(({bone,sample})=>[bone,new THREE.Vector3().fromArray(sample.evaluate(time))]));
    for(const {bone,sample} of tracks){
      rotation.fromArray(sample.evaluate(time));
      error+=rotation.angleTo(bone.quaternion)**2;
      rotations.set(bone,rotation.clone());
    }
    // A similar set of local angles may still pull a planted ankle far away.
    const matrices=new Map<THREE.Object3D,THREE.Matrix4>();
    const world=(bone:THREE.Object3D):THREE.Matrix4=>{
      const cached=matrices.get(bone);if(cached)return cached;
      const matrix=new THREE.Matrix4().compose(positions.get(bone)??bone.position,rotations.get(bone)??bone.quaternion,bone.scale);
      if(bone.parent)matrix.premultiply(world(bone.parent));
      matrices.set(bone,matrix);return matrix;
    };
    for(const {foot,position} of targets)error+=16*new THREE.Vector3().setFromMatrixPosition(world(foot)).distanceToSquared(position);
    if(error<score){score=error;best=time;}
  }
  return best;
}
