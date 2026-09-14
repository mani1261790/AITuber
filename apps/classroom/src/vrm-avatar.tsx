import { classroomMaterials } from "./classroom-materials.ts";
import { applyClassroomCamera, selectClassroomCamera, type ClassroomCameraId } from "./classroom-camera.ts";
import type { LessonDirectionView } from "@aituber/contracts";
import { useEffect, useRef, useState } from "react";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { LessonImage } from "./lesson-texture.tsx";

type AvatarMotion = "normal" | "mouth-open" | "pointing" | "reaction";

export function VrmAvatar({ state, mouthOpen, targetId, lessonImage = null, projecting = false, onSelect, direction, onStageComplete }: { direction?: LessonDirectionView | null | undefined; onStageComplete?: ((actionId: string) => void) | undefined; state: AvatarMotion; mouthOpen: boolean; targetId: string | null; lessonImage?: LessonImage | null; projecting?: boolean; onSelect?: (id: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef({ lessonImage, projecting, onSelect, direction, onStageComplete });
  useEffect(() => { stageRef.current = { lessonImage, projecting, onSelect, direction, onStageComplete }; }, [lessonImage, projecting, onSelect, direction, onStageComplete]);
  const motionRef = useRef({ state, mouthOpen, targetId });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => { motionRef.current = { state, mouthOpen, targetId }; }, [state, mouthOpen, targetId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    camera.position.set(-.15, 2.05, 7.1);
    camera.lookAt(-.15, 2.05, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c5d5, 1.3));
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
    const finishes = classroomMaterials();
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
    let environment: THREE.Group | null = null;
    let disposed = false;
    let animationFrame = 0;
    const clock = new THREE.Clock();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let destinationX = 2.35;
    let lastTarget: string | null | undefined;
    let gaitPhase = 0;
    let walkVelocity = 0;
    let gestureTarget: string | null = null;
    let gestureStarted = 0;
    let acknowledgedAction = "";
    let currentCamera: ClassroomCameraId = "front";
    let lastCameraCut = -10;
    let lastCameraCheck = -1;
    applyClassroomCamera(camera,currentCamera);
    const footPosition = new THREE.Vector3();

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loader = new GLTFLoader();
    void new GLTFLoader().loadAsync("/models/environment/classroom.glb").then(gltf => {
      if (disposed) { VRMUtils.deepDispose(gltf.scene); return; }
      environment = gltf.scene;
      environment.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.receiveShadow=true; object.castShadow=true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) {
          if (material.name === "mat21") { material.color.set("#e1ddd2"); material.bumpMap=finishes.plaster; material.bumpScale=.012; material.roughness=.88; }
          if (material.name === "mat13" || material.name === "mat18") { material.color.set("#8e9b91"); material.bumpMap=finishes.plaster; material.bumpScale=.006; material.roughness=1; }
          if (material.name === "mat15" || material.name === "mat22") { material.metalness=.45; material.roughness=.38; }
          if (material.name === "mat20") { material.map=finishes.wood.map; material.normalMap=finishes.wood.normalMap; material.color.set("#d5c5a8"); material.roughness=.65; }
        }
        object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        // Remove only the camera-facing wall to make the room a filming set.
        if (bounds && bounds.min.z > 3.1) object.visible = false;
        if (bounds && bounds.max.y < .6 && bounds.max.x-bounds.min.x < 4 && Math.abs((bounds.max.x+bounds.min.x)/2)<4.5) object.visible = false;
      });
      environment.traverse(object => { if (object instanceof THREE.Mesh) { const bounds=object.geometry.boundingBox; if (bounds && bounds.max.y < -1.5 && bounds.max.x-bounds.min.x > 8) object.visible=false; } });
      environment.scale.set(1.05,1.5,1.05);
      environment.position.set(-.3,2.15,2.35);
      scene.add(environment);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(10,.12,8),finishes.wood);
      floor.position.set(0,-.6,2.8); floor.receiveShadow=true; room.add(floor);
      // Window-side fill and soft key shadows give the presenter the same lighting context as the room.
      const windowLight = new THREE.PointLight(0xe7f2ff,8,12,2); windowLight.position.set(-4,3.2,2); scene.add(windowLight);
      room.children[0]!.visible = false; room.children[1]!.visible = false;
    }).catch(() => { /* The built-in stage remains usable offline or on asset failure. */ });
    loader.register((parser) => new VRMLoaderPlugin(parser));
    void loader.loadAsync("/models/tutor.vrm?v=aituber-teacher-v1").then((gltf) => {
      if (disposed) return;
      avatar = gltf.userData.vrm as VRM;
      VRMUtils.rotateVRM0(avatar);
      fitAvatarToStage(avatar);
      avatar.scene.scale.multiplyScalar(1.08);
      const initialDirection=stageRef.current.direction;
      const initialLeft=initialDirection?.position === "left";
      avatar.scene.position.set(initialLeft ? -4.2 : 2.35,-.15,.6);
      avatar.scene.rotation.y=initialLeft ? .26 : -.26;
      avatar.scene.updateMatrixWorld(true);
      const foot = avatar.humanoid.getRawBoneNode("leftFoot");
      if (foot) avatar.scene.position.y += -.52 - foot.getWorldPosition(footPosition).y;
      avatar.springBoneManager?.setInitState();
      avatar.springBoneManager?.reset();
      avatar.scene.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow=true; });
      scene.add(avatar.scene);
      setLoadState("ready");
    }).catch(() => { if (!disposed) setLoadState("error"); });

    const render = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;

      if (currentImage !== stageRef.current.lessonImage) {
        currentImage = stageRef.current.lessonImage;
        texture?.dispose();
        boardTexture?.dispose();
        texture = currentImage ? new THREE.CanvasTexture(currentImage.canvas) : null;
        boardTexture = currentImage ? new THREE.CanvasTexture(currentImage.boardCanvas) : null;
        if(texture) { texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=renderer.capabilities.getMaxAnisotropy(); }
        if(boardTexture) { boardTexture.colorSpace=THREE.SRGBColorSpace; boardTexture.anisotropy=renderer.capabilities.getMaxAnisotropy(); }
        boardMaterial.map=boardTexture; screenMaterial.map=texture;
        boardMaterial.needsUpdate=true; screenMaterial.needsUpdate=true;
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
        if (time-lastCameraCheck > 1) {
          lastCameraCheck = time;
          const teacherBounds = new THREE.Box3();
          for (const name of ["head","hips","leftHand","rightHand","leftUpperArm","rightUpperArm"] as const) {
            const bone = avatar.humanoid.getRawBoneNode(name);
            if (bone) teacherBounds.expandByPoint(bone.getWorldPosition(new THREE.Vector3()));
          }
          teacherBounds.expandByScalar(.16);
          const next = selectClassroomCamera(camera.aspect,teacherBounds,new THREE.Box3(new THREE.Vector3(-3.9,.7,-.25),new THREE.Vector3(.95,3.45,0)),currentCamera,time-lastCameraCut);
          if (next !== currentCamera) { currentCamera=next; lastCameraCut=time; applyClassroomCamera(camera,next); }
          renderer.domElement.dataset.camera=currentCamera;
        }
        avatar.scene.visible = true;
        const regions = stageRef.current.projecting ? currentImage?.regions : currentImage?.boardRegions;
        const targetId = direction ? direction.targetId : motionRef.current.targetId;
        const region = regions?.find(r=>r.id===targetId);
        const targetKey = `${direction?.actionId}:${stageRef.current.projecting}:${targetId}:${regions?.length}`;
        if (lastTarget !== targetKey) {
          lastTarget = targetKey;
          const side = direction?.position ?? (region && region.anchorX < .4 ? "left" : "right");
          // Keep the body outside the writing surface; central address is for an empty board.
          destinationX = side === "left" ? -4.2 : side === "center" && !stageRef.current.projecting && !regions?.length ? -.65 : 2.35;
          if (region && side !== "center") destinationX += (Math.min(1,Math.max(0,region.y))-.5)*.2;
        }
        const distance = destinationX-avatar.scene.position.x;
        const travelling = Math.abs(distance) > .18;
        const travelFacing = Math.sign(distance)*Math.PI/2;
        const standingFacing = avatar.scene.position.x < -1 ? .26 : -.26;
        const facing = travelling ? travelFacing : standingFacing;
        avatar.scene.rotation.y = THREE.MathUtils.damp(avatar.scene.rotation.y,facing,7,delta);
        const aligned = Math.abs(avatar.scene.rotation.y-travelFacing)<.3;
        const desiredVelocity = travelling && aligned ? Math.sign(distance)*Math.min(1.15,Math.sqrt(2*1.6*Math.abs(distance))) : 0;
        walkVelocity=THREE.MathUtils.damp(walkVelocity,desiredVelocity,5,delta);
        const step = Math.sign(distance)*Math.min(Math.abs(distance),Math.abs(walkVelocity)*delta);
        if (reducedMotion) avatar.scene.position.x=destinationX;
        else if (!travelling) { avatar.scene.position.x=THREE.MathUtils.damp(avatar.scene.position.x,destinationX,6,delta); walkVelocity=0; }
        else avatar.scene.position.x += step;
        const walking = !reducedMotion && (travelling || Math.abs(walkVelocity)>.03);
        gaitPhase += Math.abs(step)*8.2;
        const targetY = region ? 3.44-(region.y+region.height/2)*2.61 : 1.6;
        const elevation = Math.atan2(targetY-1.8, 2.8);
        const gestureMotion = { ...motionRef.current, state: direction ? (direction.targetId && direction.phase !== "moving" ? "pointing" as const : "normal" as const) : region && motionRef.current.mouthOpen ? motionRef.current.state : "normal" as const };
        const activeGesture = gestureMotion.state === "pointing" ? targetId ?? null : null;
        if (activeGesture !== gestureTarget) { gestureTarget=activeGesture; gestureStarted=time; }
        const gestureAge=time-gestureStarted;
        const pointWeight=activeGesture ? THREE.MathUtils.smoothstep(gestureAge,0,.5)*(1-.7*THREE.MathUtils.smoothstep(gestureAge,2.5,3.4)) : 0;
        animateAvatar(avatar, gestureMotion, time, delta, reducedMotion, elevation, walking, gaitPhase, avatar.scene.position.x < -1,pointWeight);
        renderer.domElement.dataset.teacherX=avatar.scene.position.x.toFixed(2);
        renderer.domElement.dataset.teacherMotion=walking ? "walking" : gestureMotion.state;
        avatar.scene.updateMatrixWorld(true);
        const feet = [avatar.humanoid.getRawBoneNode("leftFoot"), avatar.humanoid.getRawBoneNode("rightFoot")].filter((foot): foot is THREE.Object3D => Boolean(foot));
        if (feet.length) {
          const lowestFoot = Math.min(...feet.map(foot => foot.getWorldPosition(footPosition).y));
          avatar.scene.position.y += -.52-lowestFoot;
          avatar.scene.updateMatrixWorld(true);
        }
        avatar.springBoneManager?.update(delta);
        if (direction?.phase === "moving" && !walking && Math.abs(distance)<.04 && Math.abs(avatar.scene.rotation.y-facing)<.08 && acknowledgedAction !== direction.actionId) {
          acknowledgedAction = direction.actionId;
          stageRef.current.onStageComplete?.(direction.actionId);
        }
      }
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      if (avatar) { scene.remove(avatar.scene); VRMUtils.deepDispose(avatar.scene); }
      if (environment) VRMUtils.deepDispose(environment);
      finishes.dispose();
      renderer.domElement.removeEventListener("pointerup",click);
      texture?.dispose();
      boardTexture?.dispose();
      VRMUtils.deepDispose(room);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

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

function animateAvatar(rig: VRM, motion: { state: AvatarMotion; mouthOpen: boolean }, time: number, delta: number, reducedMotion: boolean, elevation = 0, walking = false, gaitPhase = 0, standLeft = false, pointWeight = 1) {
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
    leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, base.rotationZ + THREE.MathUtils.lerp(-1.15 + Math.sin(time*1.2)*.07*motionAmount, THREE.MathUtils.clamp(elevation,-.7,.65), pointing && standLeft ? pointWeight : 0), ease);
    leftUpperArm.rotation.x = THREE.MathUtils.lerp(leftUpperArm.rotation.x, base.rotationX + (walking ? Math.sin(gaitPhase)*.35 : Math.sin(time*.8)*.08*motionAmount), ease);
  }
  if (leftLowerArm) {
    const base = basePose(leftLowerArm);
    leftLowerArm.rotation.z = THREE.MathUtils.lerp(leftLowerArm.rotation.z, base.rotationZ - (pointing && standLeft ? .08 : .25 + (speaking ? .15*Math.sin(time*1.4) : 0)), ease);
  }
  if (rightUpperArm) {
    const base = basePose(rightUpperArm);
    rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, base.rotationZ + THREE.MathUtils.lerp(1.15 + Math.sin(time*1.2)*.07*motionAmount, -THREE.MathUtils.clamp(elevation,-.7,.65), pointing && !standLeft ? pointWeight : 0), ease);
    rightUpperArm.rotation.x = THREE.MathUtils.lerp(rightUpperArm.rotation.x, base.rotationX + (walking ? -Math.sin(gaitPhase)*.35 : -Math.sin(time*.8)*.08*motionAmount), ease);
    rightUpperArm.rotation.y = THREE.MathUtils.lerp(rightUpperArm.rotation.y, base.rotationY + (pointing ? -0.2 : 0), ease);
  }

  for (const side of ["left", "right"] as const) {
    const phase = gaitPhase + (side === "left" ? 0 : Math.PI);
    for (const [part, angle] of [["UpperLeg", Math.sin(phase)*.38], ["LowerLeg", Math.max(0,-Math.sin(phase))*.6], ["Foot", -Math.sin(phase)*.12]] as const) {
      const joint = bone(`${side}${part}`);
      if (joint) joint.rotation.x = THREE.MathUtils.lerp(joint.rotation.x,basePose(joint).rotationX+(walking ? angle : 0),ease);
    }
  }
  if (rightLowerArm) {
    const base = basePose(rightLowerArm);
    rightLowerArm.rotation.z = THREE.MathUtils.lerp(rightLowerArm.rotation.z, base.rotationZ + (pointing && !standLeft ? .18 : .25), ease);
    rightLowerArm.rotation.y = THREE.MathUtils.lerp(rightLowerArm.rotation.y, base.rotationY + (pointing ? 0.18 : -0.18), ease);
  }

  const blinkPhase = time % 4.6;
  const blink = blinkPhase > 4.42 ? Math.sin(((blinkPhase - 4.42) / 0.18) * Math.PI) : 0;
  const mouth = motion.mouthOpen ? 0.32 + 0.52 * Math.abs(Math.sin(time * 10.5)) : 0;
  rig.expressionManager?.setValue("blink", blink);
  rig.expressionManager?.setValue("aa", mouth);
  rig.expressionManager?.setValue("happy", reacting ? 0.72 : speaking ? 0.12 : 0);
  rig.expressionManager?.update();
}

function basePose(bone: THREE.Object3D) {
  const stored = bone.userData.aituberBasePose as { positionY: number; rotationX: number; rotationY: number; rotationZ: number } | undefined;
  if (stored) return stored;
  const pose = { positionY: bone.position.y, rotationX: bone.rotation.x, rotationY: bone.rotation.y, rotationZ: bone.rotation.z };
  bone.userData.aituberBasePose = pose;
  return pose;
}
