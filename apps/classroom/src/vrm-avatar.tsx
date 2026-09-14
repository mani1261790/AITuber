import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type AvatarMotion = "normal" | "mouth-open" | "pointing" | "reaction";
type MorphTarget = { influences: number[]; blinkIndices: number[]; mouthIndices: number[]; happyIndices: number[] };
type AvatarRig = { scene: THREE.Object3D; bones: Map<string, THREE.Object3D>; morphTargets: MorphTarget[] };

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

    let avatar: AvatarRig | null = null;
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
    void loader.loadAsync("/models/tutor.vrm").then(async (gltf) => {
      if (disposed) return;
      const vrm = gltf.parser.json.extensions?.VRM as { humanoid?: { humanBones?: Array<{ bone: string; node: number }> } } | undefined;
      const bones = new Map<string, THREE.Object3D>();
      for (const binding of vrm?.humanoid?.humanBones ?? []) {
        const node = await gltf.parser.getDependency("node", binding.node) as THREE.Object3D | null;
        if (node) bones.set(binding.bone, node);
      }
      avatar = { scene: gltf.scene, bones, morphTargets: collectMorphTargets(gltf.scene) };
      avatar.scene.rotation.y = Math.PI;
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
      if (avatar) { scene.remove(avatar.scene); deepDispose(avatar.scene); }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="vrm-avatar" data-avatar-ready={loadState === "ready"}>{loadState === "error" && <span role="status">3Dモデルを読み込めません</span>}</div>;
}

function collectMorphTargets(model: THREE.Object3D) {
  const targets: MorphTarget[] = [];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
    const matching = (pattern: RegExp) => Object.entries(object.morphTargetDictionary!).filter(([name]) => pattern.test(name)).map(([, index]) => index);
    targets.push({
      influences: object.morphTargetInfluences,
      blinkIndices: matching(/blink/i),
      mouthIndices: matching(/(^|[_-])(a|aa)($|[_-])|mouth.*a|fcl_mth_a/i),
      happyIndices: matching(/joy|happy|fun/i),
    });
  });
  return targets;
}

function fitAvatarToStage(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) return;
  model.scale.setScalar(2.25 / initialSize.y);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.updateMatrixWorld(true);
}

function animateAvatar(rig: AvatarRig, motion: { state: AvatarMotion; mouthOpen: boolean }, time: number, delta: number, reducedMotion: boolean) {
  const motionAmount = reducedMotion ? 0 : 1;
  const speaking = motion.state === "mouth-open" || motion.mouthOpen;
  const pointing = motion.state === "pointing";
  const reacting = motion.state === "reaction";
  const ease = 1 - Math.exp(-delta * 8);
  const bone = (name: string) => rig.bones.get(name);

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
  if (leftUpperArm) leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, 1.08, ease);
  if (rightUpperArm) {
    rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, pointing ? 0.06 : 1.08, ease);
    rightUpperArm.rotation.y = THREE.MathUtils.lerp(rightUpperArm.rotation.y, pointing ? -0.2 : 0, ease);
  }
  if (rightLowerArm) rightLowerArm.rotation.y = THREE.MathUtils.lerp(rightLowerArm.rotation.y, pointing ? 0.05 : -0.18, ease);

  const blinkPhase = time % 4.6;
  const blink = blinkPhase > 4.42 ? Math.sin(((blinkPhase - 4.42) / 0.18) * Math.PI) : 0;
  const mouth = motion.mouthOpen ? 0.32 + 0.52 * Math.abs(Math.sin(time * 10.5)) : 0;
  for (const target of rig.morphTargets) {
    for (const index of target.blinkIndices) target.influences[index] = blink;
    for (const index of target.mouthIndices) target.influences[index] = mouth;
    for (const index of target.happyIndices) target.influences[index] = reacting ? 0.72 : speaking ? 0.12 : 0.04;
  }
}

function deepDispose(model: THREE.Object3D) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}
