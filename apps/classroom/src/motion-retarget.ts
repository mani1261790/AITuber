import * as THREE from "three";
import type {VRM,VRMHumanBoneName} from "@pixiv/three-vrm";
import type {HandPose} from "./motion-catalog.ts";

const boneMap:Record<string,VRMHumanBoneName>={pelvis:"hips",spine_01:"spine",spine_02:"chest",spine_03:"upperChest",neck_01:"neck",head:"head",Head:"head"};
for(const [suffix,side] of [["l","left"],["r","right"]] as const){
  for(const [name,target] of Object.entries({clavicle:"Shoulder",upperarm:"UpperArm",lowerarm:"LowerArm",hand:"Hand",thigh:"UpperLeg",calf:"LowerLeg",foot:"Foot",ball:"Toes"}))boneMap[`${name}_${suffix}`]=`${side}${target}` as VRMHumanBoneName;
  for(const [name,target] of Object.entries({thumb:"Thumb",index:"Index",middle:"Middle",ring:"Ring",pinky:"Little"})){
    const parts=name==="thumb"?["Metacarpal","Proximal","Distal"]:["Proximal","Intermediate","Distal"];
    parts.forEach((part,i)=>{boneMap[`${name}_0${i+1}_${suffix}`]=`${side}${target}${part}` as VRMHumanBoneName;});
  }
}

for(const prefix of ["", "mixamorig"]){
  for(const [name,target] of Object.entries({Hips:"hips",Spine:"spine",Spine1:"chest",Spine2:"upperChest",Neck:"neck",Head:"head"}))boneMap[prefix+name]=target as VRMHumanBoneName;
  for(const side of ["Left","Right"]){
    for(const [part,target] of Object.entries({Shoulder:"Shoulder",Arm:"UpperArm",ForeArm:"LowerArm",Hand:"Hand",UpLeg:"UpperLeg",Leg:"LowerLeg",Foot:"Foot",ToeBase:"Toes"}))boneMap[prefix+side+part]=`${side.toLowerCase()}${target}` as VRMHumanBoneName;
    for(const finger of ["Thumb","Index","Middle","Ring","Pinky"]){
      const parts=finger==="Thumb"?["Metacarpal","Proximal","Distal"]:["Proximal","Intermediate","Distal"];
      parts.forEach((part,i)=>{boneMap[`${prefix}${side}Hand${finger}${i+1}`]=`${side.toLowerCase()}${finger==="Pinky"?"Little":finger}${part}` as VRMHumanBoneName;});
    }
  }
}

/** Bake world-space motion relative to the source T-pose onto normalized VRM bones.
 * Sampling handles animated root parents and different local bone axes together. */
export function retargetMotion(source:THREE.Object3D,clip:THREE.AnimationClip,vrm:VRM,reference?:THREE.AnimationClip){
  const mixer=new THREE.AnimationMixer(source);
  if(reference){mixer.clipAction(reference).play();mixer.setTime(0);}
  source.updateMatrixWorld(true);
  const pairs=Object.entries(boneMap).flatMap(([name,target])=>{
    const from=source.getObjectByName(name),to=vrm.humanoid.getNormalizedBoneNode(target);
    return from && to ? [{from,to,target,restInverse:from.getWorldQuaternion(new THREE.Quaternion()).invert()}]:[];
  });
  const hips=pairs.find(p=>p.target==="hips");if(!hips)throw new Error("腰の骨格を変換できません");
  const sourceRest=hips.from.getWorldPosition(new THREE.Vector3());
  const targetRest=hips.to.position.clone();
  const scale=targetRest.y/Math.max(.1,sourceRest.y);
  mixer.stopAllAction();
  const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const count=Math.ceil(clip.duration*30)+1;
  const times=Float32Array.from({length:count},(_,i)=>clip.duration*i/(count-1));
  const rotations=pairs.map(()=>new Float32Array(count*4));const positions=new Float32Array(count*3);
  const byNode=new Map(pairs.map((pair,i)=>[pair.to,i]));
  const world=pairs.map(()=>new THREE.Quaternion());const local=new THREE.Quaternion();const pos=new THREE.Vector3();
  const mirror=vrm.meta?.metaVersion==="0";
  for(let frame=0;frame<count;frame++){
    action.paused=false;
    mixer.setTime(times[frame]!);source.updateMatrixWorld(true);
    pairs.forEach((pair,i)=>{pair.from.getWorldQuaternion(world[i]!).multiply(pair.restInverse);});
    pairs.forEach((pair,i)=>{
      let parent=pair.to.parent;while(parent && !byNode.has(parent))parent=parent.parent;
      local.copy(parent ? world[byNode.get(parent)!]! : new THREE.Quaternion()).invert().multiply(world[i]!);
      if(mirror){local.x=-local.x;local.z=-local.z;}local.normalize().toArray(rotations[i]!,frame*4);
    });
    hips.from.getWorldPosition(pos).sub(sourceRest).multiplyScalar(scale);
    if(mirror){pos.x=-pos.x;pos.z=-pos.z;}pos.add(targetRest).toArray(positions,frame*3);
  }
  mixer.stopAllAction();mixer.uncacheRoot(source);
  const tracks:THREE.KeyframeTrack[]=pairs.map((pair,i)=>new THREE.QuaternionKeyframeTrack(`${pair.to.name}.quaternion`,times,rotations[i]!));
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.to.name}.position`,times,positions));
  const displacement=new THREE.Vector3().fromArray(positions,positions.length-3).sub(new THREE.Vector3().fromArray(positions));displacement.y=0;
  return {clip:new THREE.AnimationClip(clip.name,clip.duration,tracks),displacement,bones:pairs.length};
}

const openFingerCurl = { Index: .06, Middle: .12, Ring: .18, Little: .24 } as const;

/** Override only the hand; underlying body motion keeps playing. */
export function applyHandPose(vrm:VRM,pose:HandPose,side:"left"|"right",weight:number){
  if(pose==="original")return;
  const q=new THREE.Quaternion();const sign=side==="left"?1:-1;
  for(const finger of ["Index","Middle","Ring","Little"] as const){
    const curl=pose==="open"?openFingerCurl[finger]:pose==="point"?(finger==="Index"?.025:1.05):.22;
    for(const [i,part] of ["Proximal","Intermediate","Distal"].entries()){
      const joint=vrm.humanoid.getNormalizedBoneNode(`${side}${finger}${part}` as VRMHumanBoneName);
      // The middle joints close farther than the knuckles when making a pointing fist.
      const angle = pose === "point" && finger !== "Index" ? [1.45, 1.5, .8][i]! : curl*(i===2?.65:1);
      q.setFromAxisAngle(new THREE.Vector3(0,0,1),sign*angle);joint?.quaternion.slerp(q,weight);
    }
  }
  for(const part of ["Metacarpal","Proximal","Distal"] as const){
    const joint=vrm.humanoid.getNormalizedBoneNode(`${side}Thumb${part}`);
    q.setFromEuler(new THREE.Euler(pose==="point"?.2:.05,sign*(pose==="point"?.4:.1),sign*.1));joint?.quaternion.slerp(q,weight);
  }
}
