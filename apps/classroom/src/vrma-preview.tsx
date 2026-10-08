import {applyAuthoredVertexColors} from "./authored-vertex-colors.ts";
import type {MotionTrial} from "./motion-trials.ts";
import {connectHairCollisions} from "./hair-collisions.ts";
import {SpringSimulation} from "./spring-simulation.ts";
import {useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {VRMLoaderPlugin,VRMUtils,type VRM} from "@pixiv/three-vrm";
import {VRMAnimationLoaderPlugin,createVRMAnimationClip} from "@pixiv/three-vrm-animation";

export function validateVrmaBuffer(buffer:ArrayBuffer):void {
  if(buffer.byteLength<20 || buffer.byteLength>25*1024*1024) throw new Error("VRMAは25MB以内にしてください");
  const data=new DataView(buffer);
  if(data.getUint32(0,true)!==0x46546c67 || data.getUint32(4,true)!==2 || data.getUint32(8,true)!==buffer.byteLength || data.getUint32(16,true)!==0x4e4f534a) throw new Error("VRMA形式ではありません");
  const length=data.getUint32(12,true);
  if(length>buffer.byteLength-20) throw new Error("VRMAが破損しています");
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
  if(!json.extensions?.VRMC_vrm_animation) throw new Error("VRMアニメーション情報がありません");
  if([...json.buffers ?? [],...json.images ?? []].some((item:{uri?:string})=>item.uri)) throw new Error("外部ファイル参照を含むVRMAは読み込めません");
}

export function VrmaPreview({file,speed,paused,modelUrl="/models/teacher-floral-v10.vrm",trial,view="body",restart=0}:{file:File|null;speed:number;paused:boolean;modelUrl?:string;trial?:MotionTrial|undefined;view?:"body"|"hand";restart?:number}) {
  const host=useRef<HTMLDivElement>(null);const playback=useRef({speed,paused});playback.current={speed,paused};
  const [status,setStatus]=useState("VRMAファイルを選んでください");
  useEffect(()=>{
    if((!file && !trial) || !host.current) return;
    let disposed=false, frame=0, avatar:VRM|null=null, mixer:THREE.AnimationMixer|null=null;
    let spring:SpringSimulation|null=null;
    let advance:((delta:number)=>void)|null=null;
    const scene=new THREE.Scene();scene.background=new THREE.Color("#20282e");
    const camera=new THREE.PerspectiveCamera(35,1,.1,30);camera.position.set(0,1.3,3.5);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,2),3));host.current.append(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.update();
    renderer.toneMapping=THREE.NeutralToneMapping;
    scene.add(new THREE.HemisphereLight(0xffffff,0x7f8d88,3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,3);scene.add(light);
    const grid=new THREE.GridHelper(10,20,0xaab9b0,0x475a53);scene.add(grid);
    const container=host.current;const resize=()=>{renderer.setSize(container.clientWidth,container.clientHeight);camera.aspect=container.clientWidth/Math.max(1,container.clientHeight);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const clock=new THREE.Clock();
    const handPosition=new THREE.Vector3(),cameraShift=new THREE.Vector3();
    const render=()=>{if(disposed)return;const delta=Math.min(clock.getDelta(),.05);if(mixer && !playback.current.paused){const dt=delta*playback.current.speed;mixer.update(dt);advance?.(dt);if(avatar)spring?.update(dt,d=>avatar?.update(d));}if(view==="hand" && avatar){avatar.scene.updateMatrixWorld(true);const hand=avatar.humanoid.getRawBoneNode("rightHand");if(hand){hand.getWorldPosition(handPosition);cameraShift.copy(handPosition).sub(controls.target).multiplyScalar(1-Math.exp(-10*delta));controls.target.add(cameraShift);camera.position.add(cameraShift);}}controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);};render();
    setStatus("モデルとモーションを読み込み中…");
    void (async()=>{
      const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
      const model=await loader.loadAsync(modelUrl);
      if(disposed){VRMUtils.deepDispose(model.scene);return;}
      avatar=model.userData.vrm as VRM;VRMUtils.rotateVRM0(avatar);scene.add(avatar.scene);
      applyAuthoredVertexColors(avatar);
      connectHairCollisions(avatar);
      spring=new SpringSimulation([...(avatar.springBoneManager?.joints??[])].map(j=>j.bone));
      avatar.scene.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(avatar.scene),height=bounds.max.y-bounds.min.y;
      controls.target.set(0,bounds.min.y+height*.52,0);
      camera.position.set(0,bounds.min.y+height*.58,height*2.05);
      if(view==="hand"){
        const hand=avatar.humanoid.getNormalizedBoneNode("rightHand");
        if(hand){hand.getWorldPosition(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(0,.15,1.25));}
      }
      controls.update();
      const entries=trial?.steps??[{file:"uploaded"}];
      const clips:THREE.AnimationClip[]=[];
      const animations=new GLTFLoader();animations.register(parser=>new VRMAnimationLoaderPlugin(parser));
      for(const entry of entries){
        let bytes:ArrayBuffer;
        if(file)bytes=await file.arrayBuffer();
        else {const response=await fetch(entry.file);if(!response.ok)throw new Error(`素材の読込失敗: ${response.status}`);bytes=await response.arrayBuffer();}
        validateVrmaBuffer(bytes);if(disposed)return;
        const gltf=await animations.parseAsync(bytes,"");
        if(disposed){VRMUtils.deepDispose(gltf.scene);return;}
        const animation=gltf.userData.vrmAnimations?.[0];
        if(!animation){VRMUtils.deepDispose(gltf.scene);throw new Error("アニメーションがありません");}
        clips.push(createVRMAnimationClip(animation,avatar));VRMUtils.deepDispose(gltf.scene);
      }
      mixer=new THREE.AnimationMixer(avatar.scene);
      let index=0,time=0,done=false;
      let action=mixer.clipAction(clips[0]!);
      const begin=()=>{
        const clip=clips[index]!,entry=entries[index]!;
        action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
        action.setLoop(entry.seconds || entries.length===1?THREE.LoopRepeat:THREE.LoopOnce,Infinity);
        action.clampWhenFinished=true;action.play();
        renderer.domElement.dataset.trial=trial?.id??"uploaded";
        renderer.domElement.dataset.clip=entry.file;
        setStatus(`${trial?.label??file?.name} · ${index+1}/${entries.length} · ${clip.duration.toFixed(2)}秒`);
      };
      begin();
      mixer.update(0);avatar.humanoid.update();avatar.scene.updateMatrixWorld(true);
      if(view==="hand"){const hand=avatar.humanoid.getRawBoneNode("rightHand");if(hand){hand.getWorldPosition(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(.35,.12,1.1));controls.update();}}
      advance=dt=>{
        renderer.domElement.dataset.animationTime=action.time.toFixed(3);
        renderer.domElement.dataset.sequenceComplete=String(done);
        if(done || entries.length===1)return;
        time+=dt;
        const duration=entries[index]!.seconds??clips[index]!.duration;
        if(time<duration)return;
        if(index===entries.length-1){done=true;action.paused=true;setStatus(`${trial?.label} · 完了（もう一度で再生）`);return;}
        const previous=action;index++;time=0;action=mixer!.clipAction(clips[index]!);begin();
        // Short preparation clips keep their full duration; blend only across the boundary.
        action.crossFadeFrom(previous,Math.min(.25,clips[index]!.duration*.25),false);
      };

    })().catch(error=>{if(!disposed)setStatus(error instanceof Error ? error.message : "読込失敗");});
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();mixer?.stopAllAction();if(avatar){mixer?.uncacheRoot(avatar.scene);VRMUtils.deepDispose(avatar.scene);}VRMUtils.deepDispose(grid);renderer.dispose();renderer.domElement.remove();};
  },[file,modelUrl,trial,view,restart]);
  return <div className="motion-viewer vrma-trial-viewer"><p role="status">{status}</p><div className="vrma-canvas" ref={host}/></div>;
}
