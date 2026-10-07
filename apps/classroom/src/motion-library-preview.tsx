import {useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {FBXLoader} from "three/addons/loaders/FBXLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {VRMLoaderPlugin,VRMUtils,type VRM} from "@pixiv/three-vrm";
import {applyHandPose,retargetMotion} from "./motion-retarget.ts";
import type {HandPose} from "./motion-catalog.ts";

interface Props {file:string;clipName:string;speed:number;paused:boolean;travel:boolean;hand:HandPose;view:"body"|"hand"}
export function MotionLibraryPreview(props:Props){
  const replay=useRef(0),seek=useRef<number|null>(null);
  const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
  const [status,setStatus]=useState("読み込み中…");
  useEffect(()=>{
    const container=host.current;if(!container)return;
    let disposed=false,frame=0,avatar:VRM|null=null,asset:{scene:THREE.Object3D;animations:THREE.AnimationClip[]}|null=null,mixer:THREE.AnimationMixer|null=null;
    let seenReplay=0,selected="",lastView="",current:ReturnType<typeof retargetMotion>|null=null,action:THREE.AnimationAction|null=null,elapsed=0,handBlend=0,oneShot=false;
    const scene=new THREE.Scene();scene.background=new THREE.Color("#20282e");
    const camera=new THREE.PerspectiveCamera(35,1,.05,80);camera.position.set(3,1.9,4);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));container.append(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.95,0);controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff,0x8e9eab,3));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(2,4,3);scene.add(sun);
    const grid=new THREE.GridHelper(40,80,0x97bbaa,0x45584e);scene.add(grid);
    const resize=()=>{renderer.setSize(container.clientWidth,container.clientHeight);camera.aspect=container.clientWidth/Math.max(1,container.clientHeight);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const clock=new THREE.Clock(),previousRoot=new THREE.Vector3();
    const render=()=>{
      if(disposed)return;const dt=Math.min(clock.getDelta(),.05);const p=latest.current;
      if(avatar && asset && mixer){
        if(p.clipName!==selected || seenReplay!==replay.current){
          seenReplay=replay.current;
          selected=p.clipName;
          const source=asset.animations.find(c=>c.name===selected);
          if(source){
            mixer.stopAllAction();mixer.uncacheRoot(avatar.scene);avatar.humanoid.resetNormalizedPose();avatar.scene.position.set(0,0,0);elapsed=0;
            camera.position.sub(previousRoot);controls.target.sub(previousRoot);previousRoot.set(0,0,0);
            current=retargetMotion(asset.scene,source,avatar,asset.animations.find(c=>c.name==="A_TPose"));
            oneShot=props.file.endsWith(".fbx") || /^(Turn_|Sitting_Enter|Sitting_Exit|Greeting$|Bow$|Head Nod$|Yes$|Salute$)/.test(selected);
            action=mixer.clipAction(current.clip);action.setLoop(oneShot?THREE.LoopOnce:THREE.LoopRepeat,oneShot?1:Infinity);action.clampWhenFinished=true;action.play();
            renderer.domElement.dataset.clip=selected;renderer.domElement.dataset.bones=String(current.bones);
            renderer.domElement.dataset.displacement=current.displacement.length().toFixed(3);
            setStatus(`${selected}${oneShot?"（一回再生）":""} · ${source.duration.toFixed(2)}秒 · ${current.bones}骨 · 元の移動 ${current.displacement.length().toFixed(2)}m/周期`);
          }
        }
        if(action && current){
          if(seek.current!==null){elapsed=current.clip.duration*seek.current;action.paused=false;mixer.setTime(elapsed);seek.current=null;}
          if(!p.paused){elapsed+=dt*p.speed;mixer.update(dt*p.speed);}
          const hip=avatar.humanoid.getNormalizedBoneNode("hips")!;
          const root=p.travel ? current.displacement.clone().multiplyScalar(oneShot?0:Math.floor(elapsed/current.clip.duration)) : new THREE.Vector3();
          if(!p.travel){hip.position.x=0;hip.position.z=0;}
          avatar.scene.position.copy(root);
          // Preserve source travel; follow the hips without changing foot trajectories.
          handBlend=THREE.MathUtils.damp(handBlend,p.hand==="original"?0:1,9,dt);
          applyHandPose(avatar,p.hand,"right",handBlend);
          if(p.hand!=="original"){
            const arm=avatar.humanoid.getNormalizedBoneNode("rightUpperArm"),forearm=avatar.humanoid.getNormalizedBoneNode("rightLowerArm");
            const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,.8,.3));arm?.quaternion.slerp(q,handBlend);
            q.setFromEuler(new THREE.Euler(0,.35,0));forearm?.quaternion.slerp(q,handBlend);
            avatar.humanoid.getNormalizedBoneNode("rightHand")?.quaternion.slerp(new THREE.Quaternion(),handBlend);
          }
          avatar.expressionManager?.setValue("blink",Math.max(0,Math.sin((elapsed%4.7-4.5)*Math.PI/.2)));avatar.update(dt);
          avatar.scene.updateMatrixWorld(true);
          const center=hip.getWorldPosition(new THREE.Vector3());center.y=0;
          grid.position.set(Math.round(center.x/10)*10,0,Math.round(center.z/10)*10);
          camera.position.add(center.clone().sub(previousRoot));controls.target.add(center.clone().sub(previousRoot));previousRoot.copy(center);
          if(p.view!==lastView){
            lastView=p.view;
            if(p.view==="hand"){
              const hand=avatar.humanoid.getRawBoneNode("rightHand")!.getWorldPosition(new THREE.Vector3());controls.target.copy(hand);camera.position.copy(hand).add(new THREE.Vector3(-.6,.25,.7));
            }else{controls.target.copy(center).add(new THREE.Vector3(0,.95,0));camera.position.copy(center).add(new THREE.Vector3(3,1.9,4));}
          }
          renderer.domElement.dataset.time=action.time.toFixed(3);
          renderer.domElement.dataset.hips=JSON.stringify(hip.getWorldPosition(new THREE.Vector3()).toArray());
          for(const side of ["left","right"] as const){const foot=avatar.humanoid.getRawBoneNode(`${side}Foot`);if(foot)renderer.domElement.dataset[`${side}Foot`]=JSON.stringify(foot.getWorldPosition(new THREE.Vector3()).toArray());}
          const index=avatar.humanoid.getNormalizedBoneNode("rightIndexProximal")!,middle=avatar.humanoid.getNormalizedBoneNode("rightMiddleProximal")!;
          renderer.domElement.dataset.fingers=JSON.stringify({index:index.quaternion.toArray(),middle:middle.quaternion.toArray()});
        }
      }
      controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);
    };render();
    void (async()=>{
      const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
      const model=await loader.loadAsync("/models/tutor.vrm?v=aituber-teacher-v1");if(disposed){VRMUtils.deepDispose(model.scene);return;}
      avatar=model.userData.vrm as VRM;VRMUtils.rotateVRM0(avatar);scene.add(avatar.scene);mixer=new THREE.AnimationMixer(avatar.scene);
      const url=`/__motion-assets/${props.file}`;
      const fbx=props.file.endsWith(".fbx")?await new FBXLoader().loadAsync(url):null;
      const loaded=fbx?{scene:fbx,animations:fbx.animations}:await new GLTFLoader().loadAsync(url);
      if(fbx && loaded.animations[0])loaded.animations[0].name=props.clipName;if(disposed){VRMUtils.deepDispose(loaded.scene);return;}asset=loaded;

    })().catch(error=>{if(!disposed)setStatus(`読込失敗: ${error instanceof Error?error.message:String(error)}`);});
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();mixer?.stopAllAction();if(avatar){mixer?.uncacheRoot(avatar.scene);VRMUtils.deepDispose(avatar.scene);}if(asset)VRMUtils.deepDispose(asset.scene);VRMUtils.deepDispose(grid);renderer.dispose();renderer.domElement.remove();};
  },[props.file]);
  return <div className="motion-viewer" ref={host}><label className="motion-seek">場面を探す<input aria-label="場面を探す" type="range" min="0" max="100" defaultValue="0" onChange={e=>{seek.current=Number(e.target.value)/100;}}/></label><button className="motion-replay" onClick={()=>replay.current++}>最初から再生</button><p role="status">{status}</p></div>;
}
