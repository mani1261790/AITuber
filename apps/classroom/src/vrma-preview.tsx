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

export function VrmaPreview({file,speed,paused}:{file:File|null;speed:number;paused:boolean}) {
  const host=useRef<HTMLDivElement>(null);const playback=useRef({speed,paused});playback.current={speed,paused};
  const [status,setStatus]=useState("VRMAファイルを選んでください");
  useEffect(()=>{
    if(!file || !host.current) return;
    let disposed=false, frame=0, avatar:VRM|null=null, mixer:THREE.AnimationMixer|null=null;
    const scene=new THREE.Scene();scene.background=new THREE.Color("#20282e");
    const camera=new THREE.PerspectiveCamera(35,1,.1,30);camera.position.set(3,2,5);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.current.append(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff,0x7f8d88,3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,3);scene.add(light);
    const grid=new THREE.GridHelper(10,20,0xaab9b0,0x475a53);scene.add(grid);
    const container=host.current;const resize=()=>{renderer.setSize(container.clientWidth,container.clientHeight);camera.aspect=container.clientWidth/Math.max(1,container.clientHeight);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const clock=new THREE.Clock();
    const render=()=>{if(disposed)return;const delta=Math.min(clock.getDelta(),.05);if(mixer && !playback.current.paused){mixer.update(delta*playback.current.speed);avatar?.update(delta);}controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);};render();
    setStatus("モデルとモーションを読み込み中…");
    void (async()=>{
      const bytes=await file.arrayBuffer();validateVrmaBuffer(bytes);if(disposed)return;
      const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
      const model=await loader.loadAsync("/models/tutor.vrm?v=aituber-teacher-v1");
      if(disposed){VRMUtils.deepDispose(model.scene);return;}
      avatar=model.userData.vrm as VRM;VRMUtils.rotateVRM0(avatar);scene.add(avatar.scene);
      const animations=new GLTFLoader();animations.register(parser=>new VRMAnimationLoaderPlugin(parser));
      const gltf=await animations.parseAsync(bytes,"");
      if(disposed){VRMUtils.deepDispose(gltf.scene);return;}
      const animation=gltf.userData.vrmAnimations?.[0];if(!animation)throw new Error("アニメーションがありません");
      const clip=createVRMAnimationClip(animation,avatar);mixer=new THREE.AnimationMixer(avatar.scene);mixer.clipAction(clip).play();
      VRMUtils.deepDispose(gltf.scene);
      setStatus(`${file.name} · ${clip.duration.toFixed(2)}秒 · 繰り返し再生`);
    })().catch(error=>{if(!disposed)setStatus(error instanceof Error ? error.message : "読込失敗");});
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();mixer?.stopAllAction();if(avatar){mixer?.uncacheRoot(avatar.scene);VRMUtils.deepDispose(avatar.scene);}VRMUtils.deepDispose(grid);renderer.dispose();renderer.domElement.remove();};
  },[file]);
  return <div className="motion-viewer" ref={host}><p role="status">{status}</p></div>;
}
