import { useEffect, useRef, useState } from "react";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { LessonImage } from "./lesson-texture.tsx";

type AvatarMotion = "normal" | "mouth-open" | "pointing" | "reaction";

export function VrmAvatar({ state, mouthOpen, targetId, lessonImage = null, projecting = false, onSelect }: { state: AvatarMotion; mouthOpen: boolean; targetId: string | null; lessonImage?: LessonImage | null; projecting?: boolean; onSelect?: (id: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef({ lessonImage, projecting, onSelect });
  useEffect(() => { stageRef.current = { lessonImage, projecting, onSelect }; }, [lessonImage, projecting, onSelect]);
  const motionRef = useRef({ state, mouthOpen, targetId });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => { motionRef.current = { state, mouthOpen, targetId }; }, [state, mouthOpen, targetId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    camera.position.set(-.65, 2.05, 6.7);
    camera.lookAt(-.65, 2.05, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c5d5, 1.3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(-2, 4, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x7772ff, 0.45);
    rimLight.position.set(3, 2, -2);
    scene.add(rimLight);


    scene.background = new THREE.Color("#202c31");
    const room = new THREE.Group();
    scene.add(room);
    const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({color, roughness:.85}));
      mesh.position.set(x,y,z); room.add(mesh); return mesh;
    };
    box(9,5,.15,"#546260",0,1.7,-.65);
    box(9,.15,3,"#806951",0,-.68,.1);
    box(6.2,3.55,.13,"#755741",-1,1.65,-.4);
    box(5.94,3.29,.08,"#204a3d",-1,1.65,-.3);
    box(6.35,.12,.26,"#a0a4a1",-1,3.48,-.05);
    const boardMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped:false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.65,3.18), boardMaterial);
    board.position.set(-1,1.65,-.22); room.add(board);
    const screenMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped:false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.8,3.2625), screenMaterial);
    room.add(screen);
    const rail = box(5.9,.065,.1,"#bec2be",-1,3.4,-.03);
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
    let disposed = false;
    let animationFrame = 0;
    const clock = new THREE.Clock();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let destinationX = 1.7;
    let lastTarget: string | null | undefined;
    let gaitPhase = 0;
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
    loader.register((parser) => new VRMLoaderPlugin(parser));
    void loader.loadAsync("/models/tutor.vrm?v=aituber-teacher-v1").then((gltf) => {
      if (disposed) return;
      avatar = gltf.userData.vrm as VRM;
      VRMUtils.rotateVRM0(avatar);
      fitAvatarToStage(avatar);
      avatar.scene.scale.multiplyScalar(1.25);
      avatar.scene.position.set(1.7,-.15,.6);
      avatar.scene.updateMatrixWorld(true);
      const foot = avatar.humanoid.getRawBoneNode("leftFoot");
      if (foot) avatar.scene.position.y += -.52 - foot.getWorldPosition(footPosition).y;
      avatar.springBoneManager?.setInitState();
      avatar.springBoneManager?.reset();
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
      screen.scale.y=Math.max(.001,curtain);
      const screenUv = screen.geometry.attributes.uv!;
      screenUv.setY(2,1-curtain); screenUv.setY(3,1-curtain); screenUv.needsUpdate=true;
      screen.position.set(-1,3.4-3.2625*curtain/2,-.06);
      screen.visible=curtain>.002;
      rail.position.y=3.4-3.2625*curtain;
      board.visible=Boolean(currentImage);
      if (avatar) {
        const regions = stageRef.current.projecting ? currentImage?.regions : currentImage?.boardRegions;
        const region = regions?.find(r=>r.id===motionRef.current.targetId);
        const targetKey = `${stageRef.current.projecting}:${motionRef.current.targetId}:${regions?.length}`;
        if (lastTarget !== targetKey) {
          lastTarget = targetKey;
          destinationX = !region ? -.65 : region.anchorX < .4 ? 1.7 : -3;
        }
        const distance = destinationX-avatar.scene.position.x;
        const walking = Math.abs(distance) > .035 && !reducedMotion;
        const step = Math.sign(distance)*Math.min(Math.abs(distance), delta*1.05);
        avatar.scene.position.x += reducedMotion ? distance : step;
        if (walking) gaitPhase += Math.abs(step)*7.5;
        const facing = walking ? Math.sign(distance)*Math.PI/2 : (avatar.scene.position.x < -1 ? .18 : -.18);
        avatar.scene.rotation.y = THREE.MathUtils.damp(avatar.scene.rotation.y,facing,6,delta);
        const targetY = region ? 3.24-(region.y+region.height/2)*3.18 : 1.6;
        const elevation = Math.atan2(targetY-1.8, 2.8);
        animateAvatar(avatar, motionRef.current, time, delta, reducedMotion, elevation, walking, gaitPhase, avatar.scene.position.x < -1);
        avatar.scene.updateMatrixWorld(true);
        const feet = [avatar.humanoid.getRawBoneNode("leftFoot"), avatar.humanoid.getRawBoneNode("rightFoot")].filter((foot): foot is THREE.Object3D => Boolean(foot));
        if (feet.length) {
          const lowestFoot = Math.min(...feet.map(foot => foot.getWorldPosition(footPosition).y));
          avatar.scene.position.y += -.52-lowestFoot;
          avatar.scene.updateMatrixWorld(true);
        }
        avatar.springBoneManager?.update(delta);
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

function animateAvatar(rig: VRM, motion: { state: AvatarMotion; mouthOpen: boolean }, time: number, delta: number, reducedMotion: boolean, elevation = 0, walking = false, gaitPhase = 0, standLeft = false) {
  const motionAmount = reducedMotion ? 0 : 1;
  const speaking = motion.state === "mouth-open" || motion.mouthOpen;
  const pointing = motion.state === "pointing" && !walking && (reducedMotion || time % 7 < 3.8);
  const reacting = motion.state === "reaction";
  const ease = 1 - Math.exp(-delta * 8);
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
    hips.position.y = THREE.MathUtils.lerp(hips.position.y, base.positionY + motionAmount * Math.sin(time * 1.7) * 0.008 + (reacting ? 0.035 : 0), ease);
  }
  if (chest) {
    const base = basePose(chest);
    chest.rotation.z = THREE.MathUtils.lerp(chest.rotation.z, base.rotationZ + motionAmount * Math.sin(time * 1.15) * 0.025, ease);
  }
  if (head) {
    const base = basePose(head);
    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, base.rotationY + (pointing ? -.22 : motionAmount * Math.sin(time * 0.72) * 0.08), ease);
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, base.rotationX + (speaking ? motionAmount * Math.sin(time * 3.1) * 0.025 : 0), ease);
    head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, base.rotationZ + (reacting ? -0.1 : motionAmount * Math.sin(time * 0.9) * 0.018), ease);
  }
  if (leftUpperArm) {
    const base = basePose(leftUpperArm);
    leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, base.rotationZ + (pointing && standLeft ? THREE.MathUtils.clamp(elevation, -.7, .65) : -1.15 + Math.sin(time*1.2)*.07*motionAmount), ease);
    leftUpperArm.rotation.x = THREE.MathUtils.lerp(leftUpperArm.rotation.x, base.rotationX + (walking ? Math.sin(gaitPhase)*.35 : Math.sin(time*.8)*.08*motionAmount), ease);
  }
  if (leftLowerArm) {
    const base = basePose(leftLowerArm);
    leftLowerArm.rotation.z = THREE.MathUtils.lerp(leftLowerArm.rotation.z, base.rotationZ - (pointing && standLeft ? .08 : .25 + (speaking ? .15*Math.sin(time*1.4) : 0)), ease);
  }
  if (rightUpperArm) {
    const base = basePose(rightUpperArm);
    rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, base.rotationZ + (pointing && !standLeft ? -THREE.MathUtils.clamp(elevation, -.7, .65) : 1.15 + Math.sin(time*1.2)*.07*motionAmount), ease);
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
    rightLowerArm.rotation.y = THREE.MathUtils.lerp(rightLowerArm.rotation.y, base.rotationY + (pointing ? 0.05 : -0.18), ease);
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
