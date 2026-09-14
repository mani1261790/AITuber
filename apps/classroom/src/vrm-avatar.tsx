import { useEffect, useRef, useState } from "react";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type AvatarMotion = "normal" | "mouth-open" | "pointing" | "reaction";

export function VrmAvatar({ state, mouthOpen, targetId }: { state: AvatarMotion; mouthOpen: boolean; targetId: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef({ state, mouthOpen, targetId });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => { motionRef.current = { state, mouthOpen, targetId }; }, [state, mouthOpen, targetId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    camera.position.set(0, 0.88, 4.8);
    camera.lookAt(0, 0.88, 0);
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

    let avatar: VRM | null = null;
    let disposed = false;
    let animationFrame = 0;
    const clock = new THREE.Clock();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      avatar.springBoneManager?.setInitState();
      avatar.springBoneManager?.reset();
      scene.add(avatar.scene);
      setLoadState("ready");
    }).catch(() => { if (!disposed) setLoadState("error"); });

    const render = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      if (avatar) {
        const target = [...(host.closest(".stage")?.querySelectorAll<HTMLElement>("[data-semantic-id]") ?? [])].find((element) => element.dataset.semanticId === motionRef.current.targetId && !element.closest('[aria-hidden="true"]'));
        const bounds = target?.getBoundingClientRect();
        const frame = host.getBoundingClientRect();
        const elevation = bounds ? Math.atan2(frame.top + frame.height * .38 - (bounds.top + bounds.height / 2), Math.max(40, frame.left + frame.width * .55 - (bounds.left + bounds.width / 2))) : 0;
        animateAvatar(avatar, motionRef.current, time, delta, reducedMotion, elevation);
        avatar.scene.updateMatrixWorld(true);
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

function animateAvatar(rig: VRM, motion: { state: AvatarMotion; mouthOpen: boolean }, time: number, delta: number, reducedMotion: boolean, elevation = 0) {
  const motionAmount = reducedMotion ? 0 : 1;
  const speaking = motion.state === "mouth-open" || motion.mouthOpen;
  const pointing = motion.state === "pointing";
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
    leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, base.rotationZ - 0.78, ease);
  }
  if (leftLowerArm) {
    const base = basePose(leftLowerArm);
    leftLowerArm.rotation.z = THREE.MathUtils.lerp(leftLowerArm.rotation.z, base.rotationZ - 1.6, ease);
  }
  if (rightUpperArm) {
    const base = basePose(rightUpperArm);
    rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, base.rotationZ + (pointing ? -THREE.MathUtils.clamp(elevation, -.7, .65) : 1.08), ease);
    rightUpperArm.rotation.y = THREE.MathUtils.lerp(rightUpperArm.rotation.y, base.rotationY + (pointing ? -0.2 : 0), ease);
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
