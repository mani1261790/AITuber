import { lecturePixelRatio } from "./render-resolution.ts";
import { teacherModelUrl } from "./teacher-model.ts";
import { SpringSimulation } from "./spring-simulation.ts";
import { updateLessonTexture, setLessonMap } from "./lesson-texture-resource.ts";
import { connectGarmentCollisions } from "./garment-collisions.ts";
import { TeacherBlink } from "./teacher-blink.ts";
import { TeacherFace } from "./teacher-face.ts";
import { mouthOpening } from "./teacher-mouth.ts";
import { ClassroomLens, applyClassroomCamera, selectClassroomCamera, type ClassroomCameraId } from "./classroom-camera.ts";
import type { LessonDirectionView, TeachingGesture } from "@aituber/contracts";
import { useEffect, useRef, useState } from "react";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { AnimeLook, type ClassroomLook } from "./anime-look.ts";
import { AvatarGrounding, floorHeight } from "./avatar-grounding.ts";
import { StageLocomotion, stageStandingPose } from "./stage-locomotion.ts";
import { TeacherMotion } from "./teacher-motion.ts";

import type { LessonImage } from "./lesson-texture.tsx";

type AvatarMotion = "normal" | "mouth-open" | "pointing" | "reaction";

export interface MotionPreviewOptions { pace: number; stride: number }

export function VrmAvatar({ modelUrl = teacherModelUrl, look = "anime", listening = false, speaking, readSpeechLevel, inspectFeet = false, inspectFace = false, preview, state, mouthOpen, targetId, lessonImage = null, projecting = false, onSelect, direction, onStageComplete, onStageProgress }: { modelUrl?: string; listening?: boolean; speaking?: boolean | undefined; readSpeechLevel?: (()=>number|undefined)|undefined; look?: ClassroomLook; inspectFeet?: boolean; inspectFace?: boolean; preview?: MotionPreviewOptions | undefined; direction?: LessonDirectionView | null | undefined; onStageComplete?: ((actionId: string) => void) | undefined; onStageProgress?: ((actionId: string) => void) | undefined; state: AvatarMotion; mouthOpen: boolean; targetId: string | null; lessonImage?: LessonImage | null; projecting?: boolean; onSelect?: (id: string) => void }) {
  const inspectRef = useRef(inspectFeet);
  useEffect(() => { inspectRef.current = inspectFeet; }, [inspectFeet]);
  const faceInspectRef = useRef(inspectFace);
  useEffect(() => { faceInspectRef.current = inspectFace; }, [inspectFace]);
  const speechLevelRef=useRef(readSpeechLevel);
  useEffect(()=>{speechLevelRef.current=readSpeechLevel;},[readSpeechLevel]);
  const lookRef = useRef(look);
  useEffect(() => { lookRef.current = look; }, [look]);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef({ listening, lessonImage, projecting, onSelect, direction, onStageComplete, onStageProgress, preview });
  useEffect(() => { stageRef.current = { listening, lessonImage, projecting, onSelect, direction, onStageComplete, onStageProgress, preview }; }, [listening, lessonImage, projecting, onSelect, direction, onStageComplete, onStageProgress, preview]);
  const motionRef = useRef({ state, mouthOpen, speaking: speaking ?? mouthOpen, targetId });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => { motionRef.current = { state, mouthOpen, speaking: speaking ?? mouthOpen, targetId }; }, [state, mouthOpen, speaking, targetId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    camera.position.set(-.15, 2.05, 7.1);
    camera.lookAt(-.15, 2.05, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, .6);
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb8c5d5, 1.3);
    scene.add(ambient, hemisphere);
    const animeLook = new AnimeLook();
    let appliedLook: ClassroomLook | null = null;
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(-3, 5, 4);
    keyLight.castShadow = true; keyLight.shadow.mapSize.set(2048,2048);
    Object.assign(keyLight.shadow.camera,{left:-6,right:6,top:6,bottom:-4,near:.1,far:20});
    keyLight.shadow.bias=-.001; keyLight.shadow.normalBias=.03;
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x7772ff, 0.45);
    rimLight.position.set(3, 2, -2);
    scene.add(rimLight);


    scene.background = new THREE.Color("#202c31");
    const contactCanvas=document.createElement("canvas");contactCanvas.width=contactCanvas.height=64;
    const contactContext=contactCanvas.getContext("2d")!;
    const gradient=contactContext.createRadialGradient(32,32,2,32,32,32);
    gradient.addColorStop(0,"rgba(26,20,31,.55)");gradient.addColorStop(1,"rgba(26,20,31,0)");
    contactContext.fillStyle=gradient;contactContext.fillRect(0,0,64,64);
    const contactTexture=new THREE.CanvasTexture(contactCanvas);
    const contactShadows=[0,1].map(()=>{
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.65,.65),new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false,opacity:.7}));
      mesh.rotation.x=-Math.PI/2;mesh.visible=false;scene.add(mesh);return mesh;
    });
    const room = new THREE.Group();
    scene.add(room);
    const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({color, roughness:.85}));
      mesh.position.set(x,y,z); room.add(mesh); return mesh;
    };
    box(9,5,.15,"#546260",0,1.7,-.65);
    box(9,.15,3,"#806951",0,-.68,.1);
    box(6.2,3.55,.13,"#747d7b",-1,1.65,-.4);
    box(5.94,3.29,.08,"#204a3d",-1,1.65,-.3);
    box(6.35,.12,.26,"#a0a4a1",-1,3.48,-.05);
    const boardMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped:false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.65,3.18), boardMaterial);
    board.position.set(-1,1.65,-.22); room.add(board);
    const screenMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped:false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.8,3.2625), screenMaterial);
    room.add(screen);
    const rail = box(5.9,.065,.1,"#bec2be",-1,3.4,-.03);
    // Reserve a presenter lane outside the entire projected surface.
    for (const surface of room.children.slice(2)) { surface.scale.set(.82,.82,1); surface.position.x = surface.position.x*.82-.65; surface.position.y = (surface.position.y-1.65)*.82+2; }
    let currentImage: LessonImage | null = null;
    let texture: THREE.CanvasTexture | null = null;
    let boardTexture: THREE.CanvasTexture | null = null;
    let curtain = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const click = (event: PointerEvent) => {
      const frame = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX-frame.left)/frame.width*2-1,1-(event.clientY-frame.top)/frame.height*2);
      raycaster.setFromCamera(pointer,camera);
      const hit = raycaster.intersectObjects(screen.visible ? [screen, board] : [board])[0];
      if (!hit?.uv) return;
      const x=hit.uv.x, y=1-hit.uv.y;
      const regions = hit.object === screen ? currentImage?.regions : currentImage?.boardRegions;
      const region = regions?.find(r => x>=r.x && x<=r.x+r.width && y>=r.y && y<=r.y+r.height);
      if(region) stageRef.current.onSelect?.(region.id);
    };
    renderer.domElement.addEventListener("pointerup",click);
    let avatar: VRM | null = null;
    let teacherMotion: TeacherMotion | null = null;
    let environment: THREE.Group | null = null;
    let disposed = false;
    let motionReady = false;
    let grounding: AvatarGrounding | null = null;
    const floorCache=new Map<string,number>();
    const floorAt=(point:THREE.Vector3)=>{
      const key=`${environment?1:0}:${Math.round(point.x*8)}:${Math.round(point.z*8)}`;
      if(!floorCache.has(key))floorCache.set(key,floorHeight(environment,point));
      return floorCache.get(key)!;
    };
    let animationFrame = 0;
    const clock = new THREE.Clock();
    let springSimulation: SpringSimulation | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let destinationX = 2.35;
    let locomotion: StageLocomotion | null = null;
    let gaitPhase = 0;
    let walkVelocity = 0;
    let gestureTarget: string | null = null;
    let gestureStarted = 0;
    let acknowledgedAction = "";
    let lastProgressReport = 0;
    let currentCamera: ClassroomCameraId = "front";
    let lastCameraCut = -10;
    let lastCameraCheck = -1;
    const classroomLens = new ClassroomLens();
    applyClassroomCamera(camera,currentCamera);
    const footPosition = new THREE.Vector3();

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setPixelRatio(lecturePixelRatio(width, height, window.devicePixelRatio, renderer.capabilities.maxTextureSize));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);
    resize();

    const loader = new GLTFLoader();
    void new GLTFLoader().loadAsync("/models/environment/classroom-realistic.glb").then(gltf => {
      if (disposed) { VRMUtils.deepDispose(gltf.scene); return; }
      environment = gltf.scene;
      environment.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.receiveShadow = true;
        object.castShadow = true;
      });
      // The conversion script aligns the room with the lecture floor and front wall.
      scene.add(environment);
      animeLook.registerRoom(environment); appliedLook = null;
      renderer.domElement.dataset.environment = "classroom-seux";
      const windowLight = new THREE.PointLight(0xe7f2ff, 12, 14, 2);
      windowLight.position.set(3.6, 3.2, 2);
      scene.add(windowLight);
      room.children[0]!.visible = false;
      room.children[1]!.visible = false;
    }).catch(() => {
      renderer.domElement.dataset.environment = "fallback";
    });
    loader.register((parser) => new VRMLoaderPlugin(parser));
    void loader.loadAsync(modelUrl).then((gltf) => {
      if (disposed) { VRMUtils.deepDispose(gltf.scene); return; }
      avatar = gltf.userData.vrm as VRM;
      // Keep the VRM 0.x facing correction separate from stage heading.
      // StageLocomotion owns scene.rotation and would otherwise erase it.
      if (avatar.meta.metaVersion === "0") {
        const orientation = new THREE.Group();
        orientation.add(...avatar.scene.children.slice());
        orientation.rotation.y = Math.PI;
        avatar.scene.add(orientation);
        avatar.scene.updateMatrixWorld(true);
      }
      const garmentCollisions=connectGarmentCollisions(avatar);
      if(import.meta.env.DEV)renderer.domElement.dataset.garmentCollisions=JSON.stringify(garmentCollisions);
      // Preserve fine iris/eyelash texture detail at oblique lecture angles.
      const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      avatar.scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture && value.anisotropy !== maxAnisotropy) {
              value.anisotropy = maxAnisotropy;
              value.needsUpdate = true;
            }
          }
        }
      });
      animeLook.registerCharacter(avatar.scene); appliedLook = null;
      fitAvatarToStage(avatar);
      avatar.scene.scale.multiplyScalar(1.08);
      const initialDirection=stageRef.current.direction;
      const initialPose=stageStandingPose(initialDirection?.position,Boolean(initialDirection?.targetId));
      destinationX=initialPose.x;
      avatar.scene.position.set(initialPose.x,-.15,.6);
      avatar.scene.rotation.y=initialPose.yaw;
      locomotion = new StageLocomotion(avatar.scene.position.x,avatar.scene.rotation.y);
      avatar.scene.updateMatrixWorld(true);
      grounding = new AvatarGrounding(avatar);
      for(let i=0;i<20;i++)grounding.apply(avatar.scene,floorAt,1/30);
      avatar.springBoneManager?.setInitState();
      avatar.springBoneManager?.reset();
      springSimulation = new SpringSimulation([...(avatar.springBoneManager?.joints ?? [])].map(joint=>joint.bone));
      avatar.scene.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow=true; });
      scene.add(avatar.scene);
      const loadedAvatar = avatar;
      const revealPreparedAvatar = async () => {
        // Let the render loop apply the selected look while this model is hidden.
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        if(disposed)return;
        const started=performance.now();
        try {
          await renderer.compileAsync(loadedAvatar.scene,camera,scene);
          if(import.meta.env.DEV&&!disposed)renderer.domElement.dataset.shaderWarmupMs=String(performance.now()-started);
        } catch {
          // A driver without a working precompile path can still try normal rendering.
          if(import.meta.env.DEV&&!disposed)renderer.domElement.dataset.shaderWarmupMs="unavailable";
        }
        if(disposed)return;
        motionReady=true;setLoadState("ready");
      };
      void TeacherMotion.load(loadedAvatar).then(controller => {
        if (disposed) { controller.dispose(); return; }
        if(grounding)controller.setSolePoints(grounding.contactPoints());
        teacherMotion = controller;
        renderer.domElement.dataset.motionSource = "mesh2motion-cc0";
        void revealPreparedAvatar();
      }).catch(() => { if (!disposed) {
        for(let i=0;i<90;i++)animateAvatar(loadedAvatar,{state:"normal",mouthOpen:false},0,1/60,false);
        renderer.domElement.dataset.motionSource = "procedural-fallback";
        void revealPreparedAvatar();
      } });
    }).catch(() => { if (!disposed) setLoadState("error"); });

    const updateCamera = (cameraDelta: number) => {
      if (faceInspectRef.current && avatar) {
        const head=avatar.humanoid.getRawBoneNode("head");
        if(head){
          const focus=head.getWorldPosition(new THREE.Vector3());
          focus.y+=.12;
          camera.position.copy(focus).add(new THREE.Vector3(0,.06,2));
          camera.lookAt(focus);camera.updateMatrixWorld(true);
          renderer.domElement.dataset.camera="inspection-face";
        }
      } else if (inspectRef.current) {
        camera.position.set(-.9,2.8,10); camera.lookAt(-.9,1.3,0); camera.updateMatrixWorld(true);
        renderer.domElement.dataset.camera="inspection-full-body";
      } else {
        applyClassroomCamera(camera,currentCamera);
        if(avatar) camera.fov=classroomLens.update(camera,avatar.scene.position.x,destinationX,cameraDelta);
      }
      if(faceInspectRef.current || inspectRef.current)camera.fov=35;
      camera.updateProjectionMatrix();
      if(import.meta.env.DEV)renderer.domElement.dataset.cameraFov=String(camera.fov);
    };

    const render = () => {
      if (disposed) return;
      // Root travel, gait speed and pose solvers must advance on the same timestep.
      const delta = Math.min(clock.getDelta(), 1 / 30);
      animeLook.update(delta);
      const time = clock.elapsedTime;
      if (appliedLook !== lookRef.current) {
        appliedLook = lookRef.current; animeLook.apply(appliedLook);
        // Retain cel colors and skin shadow separation instead of the filmic highlight washout.
        // Projected teaching materials bypass tone mapping through their own materials.
        renderer.toneMapping = appliedLook === "anime" ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
        ambient.intensity = appliedLook === "anime" ? .35 : .6;
        hemisphere.intensity = appliedLook === "anime" ? .85 : 1.3;
        keyLight.intensity = appliedLook === "anime" ? 1.3 : 1.8;
        rimLight.intensity = appliedLook === "anime" ? .2 : .45;
        renderer.domElement.dataset.look = appliedLook;
      }

      if (currentImage !== stageRef.current.lessonImage) {
        currentImage = stageRef.current.lessonImage;
        const anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture = updateLessonTexture(texture, currentImage?.canvas ?? null, anisotropy);
        boardTexture = updateLessonTexture(boardTexture, currentImage?.boardCanvas ?? null, anisotropy);
        setLessonMap(boardMaterial, boardTexture);
        setLessonMap(screenMaterial, texture);
      }
      curtain = reducedMotion ? Number(stageRef.current.projecting) : THREE.MathUtils.damp(curtain,stageRef.current.projecting ? 1 : 0,7,delta);
      screen.scale.y=Math.max(.001,curtain)*.82;
      const screenUv = screen.geometry.attributes.uv!;
      screenUv.setY(2,1-curtain); screenUv.setY(3,1-curtain); screenUv.needsUpdate=true;
      screen.position.set(-1.47,3.44-3.2625*.82*curtain/2,-.06);
      screen.visible=curtain>.002;
      rail.position.y=3.44-3.2625*.82*curtain;
      board.visible=Boolean(currentImage);
      if (avatar) {
        const direction = stageRef.current.direction;
        avatar.scene.visible = motionReady;
        const regions = stageRef.current.projecting ? currentImage?.regions : currentImage?.boardRegions;
        const listening = stageRef.current.listening && !motionRef.current.speaking;
        const targetId = listening ? null : direction ? direction.targetId : motionRef.current.targetId;
        const gesture = listening ? "listen" : direction?.gesture ?? (motionRef.current.speaking ? "explain" : "idle");
        const region = regions?.find(r=>r.id===targetId);
        // A supplemental answer may have a focus but no stage command. Keep the
        // established position instead of inventing a crossing as speech starts.
        if (!listening && direction) {
          destinationX = stageStandingPose(direction.position,Boolean(targetId)).x;
        }
        if (time-lastCameraCheck > 1) {
          lastCameraCheck = time;
          const teacherBounds = new THREE.Box3();
          for (const name of ["head","hips","leftHand","rightHand","leftUpperArm","rightUpperArm"] as const) {
            const bone = avatar.humanoid.getRawBoneNode(name);
            if (bone) teacherBounds.expandByPoint(bone.getWorldPosition(new THREE.Vector3()));
          }
          teacherBounds.expandByScalar(.16);
          const next = selectClassroomCamera(camera.aspect,teacherBounds,new THREE.Box3(new THREE.Vector3(-3.9,.7,-.25),new THREE.Vector3(.95,3.45,0)),currentCamera,time-lastCameraCut,destinationX-avatar.scene.position.x);
          if (next !== currentCamera) { currentCamera=next; lastCameraCut=time; }
          renderer.domElement.dataset.camera=currentCamera;
        }
        const startX=avatar.scene.position.x;
        const locomotionState=teacherMotion&&locomotion&&!reducedMotion&&!stageRef.current.preview ? locomotion.update(delta,destinationX,Math.abs(destinationX+.65)<.1?0:destinationX< -1?.26:-.26,...teacherMotion.turnDurations,teacherMotion.turnRotationProgress):null;
        const distance = destinationX-avatar.scene.position.x;
        const travelling = Math.abs(distance) > .18;
        const travelFacing = Math.sign(distance)*Math.PI/2;
        const standingFacing = Math.abs(destinationX + .65) < .1 ? 0 : avatar.scene.position.x < -1 ? .26 : -.26;
        const facing = travelling ? travelFacing : standingFacing;
        avatar.scene.rotation.y = THREE.MathUtils.damp(avatar.scene.rotation.y,facing,7,delta);
        const aligned = Math.abs(avatar.scene.rotation.y-travelFacing)<.3;
        const desiredVelocity = travelling && aligned ? Math.sign(distance)*Math.min(1.15*(stageRef.current.preview?.pace ?? 1),Math.sqrt(2*1.6*Math.abs(distance))) : 0;
        walkVelocity=THREE.MathUtils.damp(walkVelocity,desiredVelocity,5,delta);
        const step = Math.sign(distance)*Math.min(Math.abs(distance),Math.abs(walkVelocity)*delta);
        if (reducedMotion) avatar.scene.position.x=THREE.MathUtils.damp(avatar.scene.position.x,destinationX,10,delta);
        else if (!travelling) { avatar.scene.position.x=THREE.MathUtils.damp(avatar.scene.position.x,destinationX,6,delta); walkVelocity=0; }
        else avatar.scene.position.x += step;
        if(locomotionState){avatar.scene.position.x=locomotionState.x;avatar.scene.rotation.y=locomotionState.yaw;}
        if(import.meta.env.DEV && locomotionState){renderer.domElement.dataset.travelSpeed=String(locomotionState.speed);renderer.domElement.dataset.travelPhase=locomotionState.phase;renderer.domElement.dataset.turnProgress=String(locomotionState.turnProgress);}
        const walking = locomotionState ? locomotionState.phase!=="idle" : !reducedMotion && (travelling || Math.abs(walkVelocity)>.03);
        gaitPhase += Math.abs(step)*8.2/(stageRef.current.preview?.stride ?? 1);
        const targetY = region ? 3.44-(region.y+region.height/2)*2.61 : 1.6;
        const elevation = teacherMotion && !stageRef.current.preview ? 0 : fallbackPointingElevation(avatar,avatar.scene.position.x < -1,targetY);
        const gestureMotion = { ...motionRef.current, state: direction ? (direction.targetId && direction.phase !== "moving" ? "pointing" as const : "normal" as const) : region && motionRef.current.mouthOpen ? motionRef.current.state : "normal" as const };
        const activeGesture = gestureMotion.state === "pointing" ? targetId ?? null : null;
        if (activeGesture !== gestureTarget) { gestureTarget=activeGesture; gestureStarted=time; }
        const gestureAge=time-gestureStarted;
        const pointWeight=activeGesture ? THREE.MathUtils.smoothstep(gestureAge,0,.5)*(1-.7*THREE.MathUtils.smoothstep(gestureAge,2.5,3.4)) : 0;
        // Aim at the camera that will render this frame, including inspection views.
        updateCamera(delta);
        if (teacherMotion && !stageRef.current.preview) {
          const target = region && activeGesture && !walking ? new THREE.Vector3(-3.85+(region.x+region.width/2)*4.76,targetY,-.06) : null;
          const speechLevel=speechLevelRef.current?.();
          teacherMotion.update(delta, { cameraPosition: camera.position, speechLevel, speed: Math.abs(avatar.scene.position.x-startX)/Math.max(delta,.001), moving: walking, speaking: motionRef.current.speaking,
            target, side: avatar.scene.position.x < -1 ? "left" : "right", reducedMotion, gesture, actionId: direction?.actionId, pointActionId: direction?.phase === "pointing" ? direction.actionId : undefined, turning: locomotionState ? locomotionState.phase==="turn" : Math.abs(avatar.scene.rotation.y-facing)>.08, turnSign: locomotionState?.turnSign, turnProgress: locomotionState?.turnProgress });
          animateExpression(avatar, gestureMotion, time, delta, speechLevel, gesture, teacherMotion.acknowledgementStrength);
          renderer.domElement.dataset.motionClip = teacherMotion.state;
          renderer.domElement.dataset.gesture = teacherMotion.category;
          if(import.meta.env.DEV){
            renderer.domElement.dataset.mouthLevel=String(avatar.expressionManager?.getValue("aa")??0);
            renderer.domElement.dataset.blinkLevel=String(avatar.expressionManager?.getValue("blink")??0);
            renderer.domElement.dataset.faceExpression=JSON.stringify({happy:avatar.expressionManager?.getValue("happy"),relaxed:avatar.expressionManager?.getValue("relaxed")});
            renderer.domElement.dataset.footSupport=JSON.stringify(teacherMotion.footSupportState);
            renderer.domElement.dataset.settlingFeet=String(teacherMotion.settlingFeet);
            renderer.domElement.dataset.gaitDiagnostics=JSON.stringify(teacherMotion.gaitDiagnostics);
            renderer.domElement.dataset.gaitCycleDistance=String(teacherMotion.gaitCycleDistance);
            renderer.domElement.dataset.speechGesture=String(teacherMotion.speechGestureStrength);
            renderer.domElement.dataset.speechOverlay=String(teacherMotion.speechOverlayWeight);
            renderer.domElement.dataset.speechLevel=String(speechLevel??"unavailable");
            const eye=avatar.humanoid.getNormalizedBoneNode("rightEye");
            if(eye)renderer.domElement.dataset.eyeRotation=JSON.stringify(eye.quaternion.toArray());
          }
        } else {
          animateAvatar(avatar, gestureMotion, time, delta, reducedMotion, elevation, walking, gaitPhase, avatar.scene.position.x < -1,pointWeight,stageRef.current.preview?.stride ?? 1);
        }
        renderer.domElement.dataset.teacherX=avatar.scene.position.x.toFixed(2);
        renderer.domElement.dataset.teacherMotion=walking ? "walking" : gestureMotion.state;
        avatar.scene.updateMatrixWorld(true);
        grounding?.apply(avatar.scene,floorAt,delta);
        grounding?.positions().forEach((sole,index)=>{
          const shadow=contactShadows[index];if(!shadow)return;
          const floor=floorAt(sole),height=Math.max(0,sole.y-floor);
          shadow.visible=true;shadow.position.set(sole.x,floor+.004,sole.z);
          shadow.material.opacity=.7*Math.exp(-height*9);
          shadow.scale.setScalar(1+height*.6);
        });
        if(import.meta.env.DEV && grounding){
          const soles=grounding.positions();
          renderer.domElement.dataset.shoeContacts=JSON.stringify(grounding.contactPoints().map(points=>points.map(p=>({x:p.x,y:p.y,z:p.z,floor:floorAt(p)}))));
          renderer.domElement.dataset.soles=JSON.stringify(soles.map(p=>({x:p.x,y:p.y,z:p.z,floor:floorAt(p)})));
        }
        if (import.meta.env.DEV) {
          renderer.domElement.dataset.teacherVisible=String(avatar.scene.visible);
          renderer.domElement.dataset.handCurl=JSON.stringify((["rightIndexProximal","rightMiddleProximal","rightRingProximal","rightLittleProximal"] as const).map(name=>avatar!.humanoid.getNormalizedBoneNode(name)?.quaternion.angleTo(new THREE.Quaternion())??null));
          renderer.domElement.dataset.teacherYaw=avatar.scene.rotation.y.toFixed(3);
          for (const name of ["hips","leftUpperLeg","leftLowerLeg","rightUpperLeg","rightLowerLeg","leftFoot","rightFoot","leftUpperArm","leftLowerArm","leftHand","rightUpperArm","rightLowerArm","rightHand","leftIndexProximal","leftIndexDistal","rightIndexProximal","rightIndexDistal","head","leftEye","rightEye"] as const) {
            const joint=avatar.humanoid.getRawBoneNode(name);
            if (joint) {joint.getWorldPosition(footPosition); renderer.domElement.dataset[name]=JSON.stringify(footPosition.toArray());}
          }
        }
        const springs = avatar.springBoneManager;
        if (springs) springSimulation?.update(delta, step => springs.update(step));
        if (direction && (direction.phase === "moving" || direction.traveling) && walking && time-lastProgressReport>2) {
          lastProgressReport=time;
          stageRef.current.onStageProgress?.(direction.actionId);
        }
        if ((direction?.phase === "moving" || direction?.traveling) && !walking && !teacherMotion?.settlingFeet && Math.abs(distance)<.04 && Math.abs(avatar.scene.rotation.y-facing)<.08 && acknowledgedAction !== direction.actionId) {
          acknowledgedAction = direction.actionId;
          stageRef.current.onStageComplete?.(direction.actionId);
        }
      }
      updateCamera(0);
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      teacherMotion?.dispose();
      contactShadows.forEach(mesh=>{mesh.geometry.dispose();mesh.material.dispose();});contactTexture.dispose();
      animeLook.dispose();
      if (avatar) { scene.remove(avatar.scene); VRMUtils.deepDispose(avatar.scene); }
      if (environment) VRMUtils.deepDispose(environment);
      renderer.domElement.removeEventListener("pointerup",click);
      texture?.dispose();
      boardTexture?.dispose();
      VRMUtils.deepDispose(room);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl]);

  return <div ref={hostRef} className="vrm-avatar" data-avatar-ready={loadState === "ready"}>{loadState === "error" && <span role="status">3Dモデルを読み込めません</span>}</div>;
}

function fitAvatarToStage(avatar: VRM) {
  const model = avatar.scene;
  model.updateMatrixWorld(true);
  const head = avatar.humanoid.getRawBoneNode("head");
  const hips = avatar.humanoid.getRawBoneNode("hips");
  if (!head || !hips) return;
  const headPosition = head.getWorldPosition(new THREE.Vector3());
  const hipsPosition = hips.getWorldPosition(new THREE.Vector3());
  const torsoHeight = headPosition.y - hipsPosition.y;
  if (!Number.isFinite(torsoHeight) || torsoHeight <= 0) return;
  model.scale.multiplyScalar(0.96 / torsoHeight);
  model.updateMatrixWorld(true);
  head.getWorldPosition(headPosition);
  model.position.x += 0.28 - headPosition.x;
  model.position.y += 1.45 - headPosition.y;
  model.updateMatrixWorld(true);
}

function fallbackPointingElevation(rig: VRM, left: boolean, targetY: number) {
  const side=left?"left":"right";
  const upper=rig.humanoid.getRawBoneNode(`${side}UpperArm`),lower=rig.humanoid.getRawBoneNode(`${side}LowerArm`),hand=rig.humanoid.getRawBoneNode(`${side}Hand`);
  if(!upper||!lower||!hand)return 0;
  const shoulder=upper.getWorldPosition(new THREE.Vector3()),elbow=lower.getWorldPosition(new THREE.Vector3()),wrist=hand.getWorldPosition(new THREE.Vector3());
  const reach=(shoulder.distanceTo(elbow)+elbow.distanceTo(wrist))*.84;
  return Math.asin(THREE.MathUtils.clamp((targetY-shoulder.y)/Math.max(reach,.001),-.97,.85));
}

function animateAvatar(rig: VRM, motion: { state: AvatarMotion; mouthOpen: boolean }, time: number, delta: number, reducedMotion: boolean, elevation = 0, walking = false, gaitPhase = 0, standLeft = false, pointWeight = 1, stride = 1) {
  const motionAmount = reducedMotion ? 0 : 1;
  const speaking = motion.state === "mouth-open" || motion.mouthOpen;
  const pointing = motion.state === "pointing" && !walking;
  const reacting = motion.state === "reaction";
  const ease = 1 - Math.exp(-delta * 4);
  const bone = (name: Parameters<VRM["humanoid"]["getRawBoneNode"]>[0]) => rig.humanoid.getRawBoneNode(name);

  const hips = bone("hips");
  const chest = bone("chest");
  const head = bone("head");
  const leftUpperArm = bone("leftUpperArm");
  const leftLowerArm = bone("leftLowerArm");
  const rightUpperArm = bone("rightUpperArm");
  const rightLowerArm = bone("rightLowerArm");

  if (hips) {
    const base = basePose(hips);
    hips.position.y = THREE.MathUtils.lerp(hips.position.y, base.positionY + motionAmount * Math.sin(time * 1.7) * 0.008 + (walking ? Math.abs(Math.sin(gaitPhase))*.018 : reacting ? .035 : 0), ease);
  }
  if (chest) {
    const base = basePose(chest);
    chest.rotation.z = THREE.MathUtils.lerp(chest.rotation.z, base.rotationZ + motionAmount * (Math.sin(time*.63)*.035+Math.sin(time*1.7)*.008), ease);
  }
  if (head) {
    const base = basePose(head);
    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, base.rotationY + (pointing ? (standLeft ? .25 : -.25) * (.65+.35*Math.sin(time*.55)) : motionAmount * (Math.sin(time*.47)*.12+Math.sin(time*1.13)*.025)), ease);
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, base.rotationX + (speaking ? motionAmount * Math.sin(time * 3.1) * 0.025 : 0), ease);
    head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, base.rotationZ + (reacting ? -0.1 : motionAmount * Math.sin(time * 0.9) * 0.018), ease);
  }
  if (leftUpperArm) {
    const base = basePose(leftUpperArm);
    leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, base.rotationZ + THREE.MathUtils.lerp(-1.15 + Math.sin(time*1.2)*.07*motionAmount, THREE.MathUtils.clamp(elevation,-1.32,1.02), pointing && standLeft ? pointWeight : 0), ease);
    leftUpperArm.rotation.x = THREE.MathUtils.lerp(leftUpperArm.rotation.x, base.rotationX + (walking ? Math.sin(gaitPhase)*.35*stride : Math.sin(time*.8)*.08*motionAmount), ease);
  }
  if (leftLowerArm) {
    const base = basePose(leftLowerArm);
    leftLowerArm.rotation.z = THREE.MathUtils.lerp(leftLowerArm.rotation.z, base.rotationZ - (pointing && standLeft ? .08 : .25 + (speaking ? .15*Math.sin(time*1.4) : 0)), ease);
  }
  if (rightUpperArm) {
    const base = basePose(rightUpperArm);
    rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, base.rotationZ + THREE.MathUtils.lerp(1.15 + Math.sin(time*1.2)*.07*motionAmount, -THREE.MathUtils.clamp(elevation,-1.32,1.02), pointing && !standLeft ? pointWeight : 0), ease);
    rightUpperArm.rotation.x = THREE.MathUtils.lerp(rightUpperArm.rotation.x, base.rotationX + (walking ? -Math.sin(gaitPhase)*.35*stride : -Math.sin(time*.8)*.08*motionAmount), ease);
    rightUpperArm.rotation.y = THREE.MathUtils.lerp(rightUpperArm.rotation.y, base.rotationY + (pointing ? -0.2 : 0), ease);
  }

  for (const side of ["left", "right"] as const) {
    const phase = gaitPhase + (side === "left" ? 0 : Math.PI);
    for (const [part, angle] of [["UpperLeg", Math.sin(phase)*.38*stride], ["LowerLeg", Math.max(0,-Math.sin(phase))*.6*stride], ["Foot", -Math.sin(phase)*.12*stride]] as const) {
      const joint = bone(`${side}${part}`);
      if (joint) joint.rotation.x = THREE.MathUtils.lerp(joint.rotation.x,basePose(joint).rotationX+(walking ? angle : 0),ease);
    }
  }
  if (rightLowerArm) {
    const base = basePose(rightLowerArm);
    rightLowerArm.rotation.z = THREE.MathUtils.lerp(rightLowerArm.rotation.z, base.rotationZ + (pointing && !standLeft ? .18 : .25), ease);
    rightLowerArm.rotation.y = THREE.MathUtils.lerp(rightLowerArm.rotation.y, base.rotationY + (pointing ? 0.18 : -0.18), ease);
  }

  animateExpression(rig, motion, time, delta);
}

const blinkControllers = new WeakMap<VRM, TeacherBlink>();
const faceControllers = new WeakMap<VRM, TeacherFace>();

function animateExpression(rig: VRM, motion: { state: AvatarMotion; mouthOpen: boolean; speaking?: boolean }, time: number, delta: number, audioLevel?:number, gesture?:TeachingGesture, acknowledgement = 0) {
  const reacting = motion.state === "reaction";
  const speaking = motion.speaking ?? (motion.state === "mouth-open" || motion.mouthOpen);
  let blinking = blinkControllers.get(rig);
  if (!blinking) { blinking = new TeacherBlink(); blinkControllers.set(rig, blinking); }
  const blink = blinking.update(delta);
  const mouth = mouthOpening(speaking,motion.mouthOpen,time,audioLevel);
  rig.expressionManager?.setValue("blink", blink);
  rig.expressionManager?.setValue("aa", THREE.MathUtils.damp(rig.expressionManager.getValue("aa") ?? 0,mouth,20,Math.min(delta,1/30)));
  let face=faceControllers.get(rig);
  if(!face){face=new TeacherFace();faceControllers.set(rig,face);}
  const expression=face.update(delta,speaking,reacting,gesture,acknowledgement);
  rig.expressionManager?.setValue("happy",expression.happy);
  rig.expressionManager?.setValue("relaxed",expression.relaxed);
  rig.expressionManager?.update();
}

function basePose(bone: THREE.Object3D) {
  const stored = bone.userData.aituberBasePose as { positionY: number; rotationX: number; rotationY: number; rotationZ: number } | undefined;
  if (stored) return stored;
  const pose = { positionY: bone.position.y, rotationX: bone.rotation.x, rotationY: bone.rotation.y, rotationZ: bone.rotation.z };
  bone.userData.aituberBasePose = pose;
  return pose;
}
