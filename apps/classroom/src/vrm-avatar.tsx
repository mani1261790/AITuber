import { useEffect, useRef, useState } from "react";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type AvatarMotion = "normal" | "mouth-open" | "pointing" | "reaction";

export function VrmAvatar({ state, mouthOpen }: { state: AvatarMotion; mouthOpen: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef({ state, mouthOpen });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => { motionRef.current = { state, mouthOpen }; }, [state, mouthOpen]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    camera.position.set(0, 0.88, 4.15);
    camera.lookAt(0, 0.88, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff5e8, 0x31334d, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.4);
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
    void loader.loadAsync("/models/tutor.vrm?v=adult-v4").then((gltf) => {
      if (disposed) return;
      avatar = gltf.userData.vrm as VRM;
      VRMUtils.rotateVRM0(avatar);
      addReadableFace(avatar);
      fitAvatarToStage(avatar.scene);
      scene.add(avatar.scene);
      setLoadState("ready");
    }).catch(() => { if (!disposed) setLoadState("error"); });

    const render = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      if (avatar) animateAvatar(avatar, motionRef.current, time, delta, reducedMotion);
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

function addReadableFace(avatar: VRM) {
  const head = avatar.scene.getObjectByName("J_Bip_C_Head");
  if (!head) return;

  const eyes = new THREE.Group();
  eyes.name = "AITuberFaceEyes";
  const irisMaterial = new THREE.MeshBasicMaterial({ color: 0x4b2924, depthWrite: false });
  const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });

  for (const x of [-0.027, 0.027]) {
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.009, 24), irisMaterial);
    iris.position.set(x, 0.061, 0.078);
    iris.scale.set(0.72, 1, 1);
    iris.renderOrder = 21;
    eyes.add(iris);

    const highlight = new THREE.Mesh(new THREE.CircleGeometry(0.0015, 12), highlightMaterial);
    highlight.position.set(x - 0.0025, 0.063, 0.079);
    highlight.renderOrder = 22;
    eyes.add(highlight);
  }

  const mouth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.021, 0.0018),
    new THREE.MeshBasicMaterial({ color: 0x9b4d55, depthWrite: false }),
  );
  mouth.position.set(0, 0.027, 0.081);
  mouth.renderOrder = 20;
  head.add(eyes, mouth);
}

function fitAvatarToStage(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) return;
  model.scale.setScalar(4.25 / initialSize.y);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.updateMatrixWorld(true);
}

function animateAvatar(rig: VRM, motion: { state: AvatarMotion; mouthOpen: boolean }, time: number, delta: number, reducedMotion: boolean) {
  const motionAmount = reducedMotion ? 0 : 1;
  const speaking = motion.state === "mouth-open" || motion.mouthOpen;
  const pointing = motion.state === "pointing";
  const reacting = motion.state === "reaction";
  const ease = 1 - Math.exp(-delta * 8);
  const bone = (name: Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0]) => rig.humanoid.getNormalizedBoneNode(name);

  const hips = bone("hips");
  const chest = bone("chest");
  const head = bone("head");
  const leftUpperArm = bone("leftUpperArm");
  const rightUpperArm = bone("rightUpperArm");
  const rightLowerArm = bone("rightLowerArm");

  if (hips) hips.position.y = THREE.MathUtils.lerp(hips.position.y, motionAmount * Math.sin(time * 1.7) * 0.008 + (reacting ? 0.035 : 0), ease);
  if (chest) chest.rotation.z = THREE.MathUtils.lerp(chest.rotation.z, motionAmount * Math.sin(time * 1.15) * 0.025, ease);
  if (head) {
    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, motionAmount * Math.sin(time * 0.72) * 0.08, ease);
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, speaking ? motionAmount * Math.sin(time * 3.1) * 0.025 : 0, ease);
    head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, reacting ? -0.1 : motionAmount * Math.sin(time * 0.9) * 0.018, ease);
  }
  if (leftUpperArm) leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, -1.08, ease);
  if (rightUpperArm) {
    rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, pointing ? 0.06 : 1.08, ease);
    rightUpperArm.rotation.y = THREE.MathUtils.lerp(rightUpperArm.rotation.y, pointing ? -0.2 : 0, ease);
  }
  if (rightLowerArm) rightLowerArm.rotation.y = THREE.MathUtils.lerp(rightLowerArm.rotation.y, pointing ? 0.05 : -0.18, ease);

  const blinkPhase = time % 4.6;
  const blink = blinkPhase > 4.42 ? Math.sin(((blinkPhase - 4.42) / 0.18) * Math.PI) : 0;
  const mouth = motion.mouthOpen ? 0.32 + 0.52 * Math.abs(Math.sin(time * 10.5)) : 0;
  rig.expressionManager?.setValue("neutral", 1);
  rig.expressionManager?.setValue("blink", blink);
  rig.expressionManager?.setValue("aa", mouth);
  rig.expressionManager?.setValue("happy", reacting ? 0.72 : speaking ? 0.12 : 0);
  const faceEyes = rig.scene.getObjectByName("AITuberFaceEyes");
  if (faceEyes) faceEyes.scale.y = Math.max(0.08, 1 - blink);
  rig.update(delta);
}
