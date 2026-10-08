import { withLightWalk } from "./light-walk.ts";
import { StandingRecovery } from "./standing-recovery.ts";
import { withTeacherStance } from "./standing-motion.ts";
import { createTurnProgress, defaultTurnProgress } from "./turn-timing.ts";
import { closestWalkPhase } from "./walk-phase.ts";
import { TeachingFocus } from "./teaching-focus.ts";
import { PointTarget } from "./point-target.ts";
import { SpeechGesture } from "./speech-gesture.ts";
import * as THREE from "three";
import { PointingCue } from "./pointing-cue.ts";
import { FootContact } from "./foot-contact.ts";
import { applyTeacherAttention, applyTravelAttention, TeacherGaze, teacherGazeTarget, teacherForwardSign } from "./teacher-attention.ts";
import { PoseTransition, pointingHandGoal, pointingElbowGoal } from "./pose-transition.ts";
import type { VRM } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { VRMUtils, VRMHumanBoneName } from "@pixiv/three-vrm";
import { applyHandPose, retargetMotion } from "./motion-retarget.ts";

/** Remove net horizontal travel while preserving the recorded pelvis sway and weight shifts. */
export function removeHorizontalTravel(clip: THREE.AnimationClip) {
  const result = clip.clone();
  for (const track of result.tracks) {
    if (!track.name.endsWith(".position")) continue;
    const count=track.times.length;
    if(count<2)continue;
    const start=track.times[0]!,duration=track.times[count-1]!-start;
    if(duration<=0)continue;
    const dx=track.values[(count-1)*3]!-track.values[0]!;
    const dz=track.values[(count-1)*3+2]!-track.values[2]!;
    for(let frame=0;frame<count;frame++){
      const t=(track.times[frame]!-start)/duration;
      track.values[frame*3]=track.values[frame*3]!-dx*t;
      track.values[frame*3+2]=track.values[frame*3+2]!-dz*t;
    }
  }
  return result;
}

export function walkPlaybackRate(speed: number, cycleDistance: number, duration: number) {
  return cycleDistance > .001 ? Math.max(0, speed) * duration / cycleDistance : 0;
}

import type { TeachingGesture } from "@aituber/contracts";

type MotionState = "idle" | "talk" | "walk" | "listen" | "turnLeft" | "turnRight";
export class TeacherMotion {
  private poseOffsets = new Map<THREE.Object3D,{rotation:THREE.Quaternion;position:THREE.Vector3}>();
  private poseOffsetAge = 1;
  private poseOffsetDuration = .65;
  private turnPoseOffset = false;
  private lowerBodyBones = new Set<THREE.Object3D>();
  private lastTurnProgress = 0;
  private quietArms = new Map<THREE.Object3D,THREE.Quaternion>();
  private quietArmWeight = 0;
  private gaze: TeacherGaze;
  private mixer: THREE.AnimationMixer;
  private actions: Record<MotionState, THREE.AnimationAction>;
  private weights = { idle: 1, talk: 0, walk: 0, listen: 0, turnLeft: 0, turnRight: 0 };
  private transition: PoseTransition;
  private outputLimit: PoseTransition;
  private footContact: FootContact;
  private standingRecovery: StandingRecovery;
  get settlingFeet(){return this.standingRecovery.active;}
  gaitDiagnostics: Record<string,number[]> = {};
  private sampleKnees(stage:string){
    if(!import.meta.env.DEV)return;
    this.vrm.scene.updateMatrixWorld(true);
    this.gaitDiagnostics[stage]=(["left","right"] as const).map(side=>{
      const positions=(["UpperLeg","LowerLeg","Foot"] as const).map(part=>this.vrm.humanoid.getNormalizedBoneNode(`${side}${part}`)?.getWorldPosition(new THREE.Vector3()));
      const [hip,knee,foot]=positions;
      return hip&&knee&&foot ? Math.PI-hip.sub(knee).angleTo(foot.sub(knee)) : 0;
    });
  }
  private pointCue = new PointingCue();
  private teachingFocus = new TeachingFocus();
  setSolePoints(points: THREE.Vector3[][]) { this.footContact.setSolePoints(points); }
  private postIkError: number[] = [];
  get footSupportState() { return this.footContact.supportState.map((state,i)=>({...state,postBlendError:this.postIkError[i]??0})); }
  private mixerPositions = new Map<THREE.Object3D, THREE.Vector3>();
  turnRotationProgress = (progress:number,sign:number) => (sign < 0 ? this.turnTiming?.right : this.turnTiming?.left)?.(progress) ?? defaultTurnProgress(progress);
  get turnDurations() { return [this.actions.turnLeft.getClip().duration*.6, this.actions.turnRight.getClip().duration*.6] as const; }
  private speakingHold = 0;
  private speechGesture = new SpeechGesture();
  private speechStrength = 0;
  get speechGestureStrength() { return this.speechStrength; }
  get speechOverlayWeight() { return this.weights.talk; }
  private overlayBases = new Map<THREE.Object3D, THREE.Quaternion>();
  private gestureKey = "";
  private gestureKind: TeachingGesture | undefined;
  private gestureAge = 0;
  private gestureLeadSide: "left" | "right" = "right";
  private nextExplanationSide: "left" | "right" = "right";
  private listeningAge = 0;
  private acknowledgement = 0;
  get acknowledgementStrength() { return this.acknowledgement; }
  category = "idle";
  private pointBlend = 0;
  private pointSide: "left" | "right" = "right";
  private pointTracking = new PointTarget();
  private pointTrackingInitialized = false;
  private pointTarget = this.pointTracking.position;
  private walkDistance: number;
  get gaitCycleDistance() { return this.walkDistance; }
  state: MotionState = "idle";

  static async load(vrm: VRM) {
    const loader = new GLTFLoader();
    const loaded = await Promise.allSettled([loader.loadAsync("/models/motions/teacher.glb"), loader.loadAsync("/models/motions/teacher-idle.glb"), loader.loadAsync("/models/motions/teacher-addon.glb"), loader.loadAsync("/models/motions/teacher-turns.glb")]);
    if (loaded.some(result => result.status === "rejected")) {
      loaded.forEach(result => { if (result.status === "fulfilled") VRMUtils.deepDispose(result.value.scene); });
      throw new Error("Teacher motion assets could not be loaded");
    }
    const source = (loaded[0] as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>).value;
    const idleSource = (loaded[1] as PromiseFulfilledResult<typeof source>).value;
    const addon = (loaded[2] as PromiseFulfilledResult<typeof source>).value;
    const turns = (loaded[3] as PromiseFulfilledResult<typeof source>).value;
    const convert = (asset:typeof source,name:string) => {
      const clip=asset.animations.find(c=>c.name===name); if(!clip)throw new Error(`Missing clip ${name}`);
      return retargetMotion(clone(asset.scene),clip,vrm).clip;
    };
    try {
      const reference = source.animations.find(clip => clip.name === "A_TPose");
      const motions = ["Idle_Talking_Loop"].map(name => {
        const clip = source.animations.find(candidate => candidate.name === name);
        if (!clip) throw new Error(`Missing teacher motion: ${name}`);
        return retargetMotion(clone(source.scene), clip, vrm, reference);
      });
      const idle = withTeacherStance(vrm,retargetMotion(idleSource.scene, idleSource.animations[0]!, vrm).clip);
      const walk=withLightWalk(vrm,convert(addon,"Walk_Female"));
      const stride=estimateWalkDistance(vrm,walk);
      const turnLeft=convert(turns,"Turn_Left_90"),turnRight=convert(turns,"Turn_Right_90");
      const hipsName=vrm.humanoid.getNormalizedBoneNode("hips")?.name;
      return new TeacherMotion(vrm,idle,motions[0]!.clip,walk,stride,{
        listen:convert(addon,"Idle Listening"),
        turnLeft:removeTurnYaw(turnLeft,vrm),
        turnRight:removeTurnYaw(turnRight,vrm),
      }, {left:createTurnProgress(turnLeft,hipsName),right:createTurnProgress(turnRight,hipsName)});
    } finally { VRMUtils.deepDispose(source.scene); VRMUtils.deepDispose(idleSource.scene); VRMUtils.deepDispose(addon.scene); VRMUtils.deepDispose(turns.scene); }
  }

  constructor(private vrm: VRM, idle: THREE.AnimationClip, talk: THREE.AnimationClip, walk: THREE.AnimationClip, distance: number, extra?: {listen:THREE.AnimationClip;turnLeft:THREE.AnimationClip;turnRight:THREE.AnimationClip}, private turnTiming?: {left:(progress:number)=>number;right:(progress:number)=>number}) {
    this.gaze = new TeacherGaze(vrm);
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.footContact = new FootContact(vrm);
    for (const name of Object.values(VRMHumanBoneName)) {
      if(name === "leftEye" || name === "rightEye")continue;
      const bone = vrm.humanoid.getNormalizedBoneNode(name);
      if (bone) {
        this.overlayBases.set(bone, bone.quaternion.clone());
        this.mixerPositions.set(bone, bone.position.clone());
      }
    }
    this.transition = new PoseTransition(this.overlayBases.keys());
    // A speech overlay must never replace the pelvis or foot-placement motion,
    // including when callers supply a full-body talk clip.
    const lowerBones = ["hips", "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes", "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"] as const;
    this.lowerBodyBones = new Set(lowerBones.flatMap(name=>{const bone=vrm.humanoid.getNormalizedBoneNode(name);return bone?[bone]:[];}));
    const lowerNames = new Set(lowerBones.map(name => vrm.humanoid.getNormalizedBoneNode(name)?.name));
    const upperTalk = talk.clone();
    upperTalk.tracks = upperTalk.tracks.filter(track => !lowerNames.has(track.name.split(".")[0]));
    const upperListen = (extra?.listen ?? idle).clone();
    const listeningNames = new Set((["spine","chest","upperChest","neck","head"] as const).map(name=>vrm.humanoid.getNormalizedBoneNode(name)?.name));
    upperListen.tracks = upperListen.tracks.filter(track => listeningNames.has(track.name.split(".")[0]));
    this.actions = {
      idle: this.mixer.clipAction(removeHorizontalTravel(idle)),
      talk: this.mixer.clipAction(removeHorizontalTravel(upperTalk)),
      walk: this.mixer.clipAction(removeHorizontalTravel(walk)),
      listen: this.mixer.clipAction(removeHorizontalTravel(upperListen)),
      turnLeft: this.mixer.clipAction(removeHorizontalTravel(extra?.turnLeft ?? idle.clone())),
      turnRight: this.mixer.clipAction(removeHorizontalTravel(extra?.turnRight ?? idle.clone())),
    };
    for (const key of ["turnLeft","turnRight"] as const) { this.actions[key].setLoop(THREE.LoopOnce,1);this.actions[key].clampWhenFinished=true; }
    this.walkDistance = distance * Math.abs(vrm.scene.scale.x);
    for (const [key, action] of Object.entries(this.actions)) action.setEffectiveWeight(key === "idle" ? 1 : 0).play();
    // Establish the first standing pose while the avatar is still hidden.
    this.mixer.update(0);
    for(const side of ["left","right"] as const)for(const part of ["UpperArm","LowerArm","Hand"] as const){
      const bone=vrm.humanoid.getNormalizedBoneNode(`${side}${part}`);
      if(bone)this.quietArms.set(bone,bone.quaternion.clone());
    }
    // Capture the authored idle pose, including its foot width and toe-in.
    this.standingRecovery = new StandingRecovery(vrm);
    this.overlayBases.forEach((base,bone)=>base.copy(bone.quaternion));
    this.mixerPositions.forEach((base,bone)=>base.copy(bone.position));
    const armBones = new Set((["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"] as const)
      .map(name => vrm.humanoid.getNormalizedBoneNode(name)));
    // Keep a suddenly withdrawn gesture from whipping the elbow back to rest.
    // Fingers retain their quicker response, and gait timing is unchanged.
    this.transition = new PoseTransition(this.overlayBases.keys(), 10, bone => armBones.has(bone) ? 3 : 5);
    const legBones = new Set((["leftUpperLeg","leftLowerLeg","leftFoot","rightUpperLeg","rightLowerLeg","rightFoot"] as const).map(name=>this.vrm.humanoid.getNormalizedBoneNode(name)));
    const legs = (["left", "right"] as const).map(side =>
      (["UpperLeg", "LowerLeg", "Foot"] as const).flatMap(part => {
        const bone=this.vrm.humanoid.getNormalizedBoneNode(`${side}${part}`);
        return bone ? [bone] : [];
      }));
    this.outputLimit = new PoseTransition(this.overlayBases.keys(), Infinity, bone=>legBones.has(bone) && this.state === "walk" ? 8 : 5, legs);
    this.vrm.humanoid.update();
  }

  update(delta: number, input: { speed: number; moving: boolean; speaking: boolean; speechLevel?: number | undefined; target: THREE.Vector3 | null; cameraPosition?: THREE.Vector3; side: "left" | "right"; reducedMotion: boolean; gesture?: TeachingGesture | undefined; actionId?: string | undefined; pointActionId?: string | undefined; turning?: boolean | undefined; turnSign?: number | undefined; turnProgress?: number | undefined; departureWalkBlend?: number | undefined }) {
    delta = Math.min(Math.max(delta, 0), 1 / 30);
    const voiced = input.speaking && (input.speechLevel === undefined || input.speechLevel > .045);
    const indicating = this.pointCue.update(delta,input.moving ? null : input.target,voiced,input.pointActionId);
    this.speakingHold = input.speaking ? .7 : Math.max(0, this.speakingHold - delta);
    const previousState = this.state;
    if (input.reducedMotion) this.state = "idle";
    else if (input.turning) this.state = input.turnSign === -1 ? "turnRight" : "turnLeft";
    else if (input.moving) this.state = "walk";
    else if (input.gesture === "listen" && !input.target && this.speakingHold === 0) this.state = "listen";
    else if (this.speakingHold > 0 && !["idle", "nod"].includes(input.gesture ?? "explain") && !indicating) this.state = "talk";
    else this.state = "idle";
    if(input.moving || input.turning || input.reducedMotion)this.standingRecovery.cancel();
    else if(["walk","turnLeft","turnRight"].includes(previousState))this.standingRecovery.begin();
    this.listeningAge = this.state === "listen" ? (previousState === "listen" ? this.listeningAge + delta : 0) : 0;
    if((this.state === "walk" && previousState !== "walk" && this.actions.walk.getEffectiveWeight()<.01) || (input.turning && (input.departureWalkBlend??0)>0 && this.actions.walk.getEffectiveWeight()<.001)) {
      const bones=(["hips","leftUpperLeg","leftLowerLeg","leftFoot","rightUpperLeg","rightLowerLeg","rightFoot"] as const)
        .flatMap(name=>{const bone=this.vrm.humanoid.getNormalizedBoneNode(name);return bone?[bone]:[];});
      const feet = (["leftFoot", "rightFoot"] as const).flatMap(name => {
        const foot = this.vrm.humanoid.getNormalizedBoneNode(name);
        return foot ? [foot] : [];
      });
      this.actions.walk.time = closestWalkPhase(this.actions.walk.getClip(), bones, 48, feet);
    }
    const enteringTurn = !input.reducedMotion && !!input.turning && (this.state !== previousState || (input.turnProgress??0) < this.lastTurnProgress-.5);
    this.lastTurnProgress=input.turnProgress??0;
    const enteringPoint = indicating && !input.moving && this.pointBlend <= .001;
    const endingBeat = !input.moving && !input.turning
      && ["emphasize", "explain", "nod"].includes(this.gestureKind ?? "")
      && ["idle", "listen"].includes(input.gesture ?? "idle");
    const entryPose = enteringTurn || enteringPoint || endingBeat ? new Map([...this.overlayBases.keys()].map(bone=>[bone,{rotation:bone.quaternion.clone(),position:bone.position.clone()}])) : null;
    this.speechStrength = this.speechGesture.update(delta, input.speaking, input.speechLevel);
    const speechWeight = this.state === "talk" ? .55 : this.state === "walk" && input.gesture !== "idle" ? .3 : 0;
    const departureBlend=input.turning?THREE.MathUtils.clamp(input.departureWalkBlend??0,0,1):0;
    for (const key of ["idle", "talk", "walk", "listen", "turnLeft", "turnRight"] as const) {
      const targetWeight = key === "idle" ? Number(this.state === "idle" || this.state === "talk" || this.state === "listen") : key === "talk" ? speechWeight * this.speechStrength : key === "listen" ? (this.state === "listen" ? .65 : 0) : key === "walk" && input.turning ? departureBlend : Number(this.state === key)*(key.startsWith("turn")?1-departureBlend:1);
      this.weights[key] = enteringTurn ? targetWeight : THREE.MathUtils.damp(this.weights[key], targetWeight, 7, delta);
      this.actions[key].setEffectiveWeight(this.weights[key]);
    }
    for (const key of ["turnLeft","turnRight"] as const) {
      const action=this.actions[key];action.paused=true;
      if(this.state===key) { action.enabled=true;action.time=Math.min(.9999,input.turnProgress??0)*action.getClip().duration; }
    }
    this.actions.listen.setEffectiveTimeScale(input.reducedMotion?0:1);
    this.actions.walk.setEffectiveTimeScale(walkPlaybackRate(input.speed, this.walkDistance, this.actions.walk.getClip().duration));
    this.actions.idle.setEffectiveTimeScale(input.reducedMotion ? 0 : 1);
    this.actions.talk.setEffectiveTimeScale(input.reducedMotion ? 0 : 1);
    // Three skips writing unchanged tracks. Restore the pre-overlay pose first,
    // otherwise nod/aim offsets accumulate on constant animation keys.
    this.overlayBases.forEach((base, bone) => bone.quaternion.copy(base));
    this.mixerPositions.forEach((base, bone) => bone.position.copy(base));
    this.mixer.update(delta);
    this.mixerPositions.forEach((base, bone) => base.copy(bone.position));
    this.overlayBases.forEach((base, bone) => base.copy(bone.quaternion));
    this.sampleKnees("clip");
    // Stage travel is incidental to the lesson: retain a small counter-swing,
    // including during spoken travel and pivot clips, around the relaxed idle arms.
    this.quietArmWeight=THREE.MathUtils.damp(this.quietArmWeight,input.moving||input.turning?1:0,7,delta);
    this.quietArms.forEach((rest,bone)=>bone.quaternion.slerp(rest,this.quietArmWeight*.82));


    const pointing = indicating && !input.moving;
    // Retract the old arm before switching sides, rather than snapping between arms.
    const sameSide = input.side === this.pointSide;
    // A departure already rotates the torso; lower the arm more gently during that turn.
    const pointDuration = !pointing && (input.moving || input.turning) ? 1.15 : .8;
    this.pointBlend = THREE.MathUtils.clamp(this.pointBlend + (pointing && sameSide ? 1 : -1)*delta/pointDuration,0,1);
    if (this.pointBlend < .01) this.pointSide = input.side;
    if (input.target) {
      // Only initialize while invisible. Later cues retain focus velocity, including
      // cues arriving while the old arm is retracting or the new arm is rising.
      if (!this.pointTrackingInitialized) {
        this.pointTracking.reset(input.target);
        this.pointTrackingInitialized = true;
      } else this.pointTracking.update(input.target, delta);
    }
    const focusWeight = this.teachingFocus.update(delta, input.target?.toArray().map(n=>n.toFixed(2)).join(":"), input.speaking, input.pointActionId)
      * THREE.MathUtils.smootherstep(this.pointBlend,0,1);
    if(input.moving || input.turning)
      applyTravelAttention(this.vrm,teacherGazeTarget(this.vrm,true));
    // Introduce the board detail, then address the audience without retracting the arm.
    if (input.cameraPosition && !input.moving && !input.turning)
      applyTeacherAttention(this.vrm,input.cameraPosition,.65*(1-focusWeight));
    if (focusWeight > .001) applyTeacherAttention(this.vrm,this.pointTarget,focusWeight);
    const key = `${input.actionId}:${input.gesture}`;
    if (key !== this.gestureKey) {
      // Short adjacent beats may arrive before the presenting hand returns.
      // Finish that gesture instead of abruptly restarting it on the other side.
      const carryExplanation = this.gestureKind === "explain" && input.gesture === "explain"
        && this.gestureAge > 0 && this.gestureAge < 3.4;
      this.gestureKey = key; this.gestureKind = input.gesture;
      if (!carryExplanation) this.gestureAge = 0;
    }
    // Do not consume a one-shot gesture while locomotion suppresses its pose.
    const retractingBeforeEmphasis = input.gesture === "emphasize" && !pointing && this.pointBlend > .001;
    const canStartGesture = voiced && !input.moving && !input.turning && !input.reducedMotion && !retractingBeforeEmphasis;
    if (this.gestureAge === 0 && canStartGesture) {
      this.gestureLeadSide = this.pointBlend > .001 ? (this.pointSide === "right" ? "left" : "right") : "right";
      // Vary complete spoken beats, never switch hands mid-phrase or on a timer.
      if (input.gesture === "explain" && this.pointBlend <= .001) {
        this.gestureLeadSide = this.nextExplanationSide;
        this.nextExplanationSide = this.nextExplanationSide === "right" ? "left" : "right";
      }
    }
    if (!["nod","emphasize","explain"].includes(input.gesture ?? "") || canStartGesture || this.gestureAge > 0) this.gestureAge += delta;
    this.category = input.turning ? "turn" : input.moving ? (input.speed < .03 ? "turn" : "walk") : indicating ? "point" : input.gesture ?? this.state;
    this.acknowledgement = 0;
    if (!input.reducedMotion && !input.moving) {
      const forward = teacherForwardSign(this.vrm);
      const head = this.vrm.humanoid.getNormalizedBoneNode("head");
      const chest = this.vrm.humanoid.getNormalizedBoneNode("chest");
      const envelope = this.gestureAge < 1.2 ? Math.sin(Math.PI * this.gestureAge / 1.2) ** 2 : 0;
      if (input.gesture === "nod" && head) {
        this.acknowledgement = envelope;
        head.rotateX(forward * .18 * envelope);
      }
      // Pointing already supplies the explanatory gesture; avoid a two-arm shrug.
      if (input.gesture === "emphasize" || (input.gesture === "explain" && this.pointBlend <= .001)) {
        const emphasis = input.gesture === "emphasize";
        if (emphasis) { head?.rotateX(forward * .08 * envelope); chest?.rotateX(forward * .07 * envelope); }
        for(const side of ["right","left"] as const){
          // Pointing owns its arm; the free hand can still underline the explanation.
          const availability = side === this.pointSide ? 1-THREE.MathUtils.smootherstep(this.pointBlend,0,1) : 1;
          const leadSide = this.gestureLeadSide;
          const leading = side === leadSide;
          // Explain once at speech onset with a visible presenting hand above the waist.
          // Emphasis reaches higher and adds the supporting hand; neither repeats on a timer.
          if (!emphasis && !leading) continue;
          const t=this.gestureAge/(emphasis?2.6:3.4);
          const amount=t>0&&t<1?Math.sin(Math.PI*t)**2:0;
          const target = presentingHandTarget(this.vrm,side,emphasis);
          if(target && amount>0){
            const accompaniment = emphasis ? 1-.35*THREE.MathUtils.smootherstep(this.pointBlend,0,1) : 1;
            aimArm(this.vrm,side,target,amount*.96*availability*accompaniment,"open");
          }
        }
      }
      if (this.state === "listen" && head) {
        head.rotateZ(.045 * Math.min(1, this.listeningAge / .5));
        // Acknowledge entering attentive listening once, then let the idle motion settle.
        const t=(this.listeningAge-.25)/1.25;
        const acknowledgement=t>0&&t<1 ? Math.sin(Math.PI*t)**2 : 0;
        head.rotateX(forward * .12*acknowledgement);
        chest?.rotateX(forward * .025*acknowledgement);
      }
    }
    // Solve after torso gestures so a small emphasis lean does not shift the aim.
    if (this.pointBlend > .001) aimArm(this.vrm, this.pointSide, this.pointTarget, THREE.MathUtils.smootherstep(this.pointBlend,0,1));
    // Keep the target; solve eyes only after the body reaches its final pose.
    const audience = teacherGazeTarget(this.vrm, input.moving || !!input.turning, input.cameraPosition);
    const gazeTarget = audience.lerp(this.pointTarget, focusWeight);
    // Pose continuity also covers clip changes and releasing a pointing gesture.
    // Preserve turn/point entries and the release of spoken gestures after all procedural gestures, so offsets
    // never apply the outgoing gesture twice. Decay only the mismatch, not the clip.
    if(entryPose){
      this.poseOffsetAge=0;
      this.turnPoseOffset=enteringTurn;
      // Let a finished speech beat settle gently; keep locomotion and pointing responsive.
      this.poseOffsetDuration = endingBeat && !enteringPoint && !enteringTurn ? .95 : .65;
      this.poseOffsets.clear();
      entryPose.forEach((pose,bone)=>this.poseOffsets.set(bone,{rotation:pose.rotation.multiply(bone.quaternion.clone().invert()),position:pose.position.sub(bone.position)}));
    }
    const offsetWeight=1-THREE.MathUtils.smootherstep(this.poseOffsetAge/this.poseOffsetDuration,0,1);
    if(offsetWeight>0)this.poseOffsets.forEach((offset,bone)=>{
      // Turn foot placement must follow the root's turn clock, not remain in the outgoing stance.
      const weight=this.turnPoseOffset && this.lowerBodyBones.has(bone)
        ? 1-THREE.MathUtils.smootherstep(this.poseOffsetAge/.28,0,1) : offsetWeight;
      bone.quaternion.premultiply(new THREE.Quaternion().slerp(offset.rotation,weight));
      bone.position.addScaledVector(offset.position,weight);
    });
    this.poseOffsetAge+=delta;
    this.transition.apply(delta);
    this.sampleKnees("blended");
    this.footContact.apply(delta,input.moving && !input.reducedMotion,input.turning);
    this.sampleKnees("contact");
    this.standingRecovery.apply(delta);
    // IK may rewrite joints after blending. Bound the final rendered pose too,
    // without adding another low-pass delay to ordinary foot contact.
    const solvedFeet = import.meta.env.DEV ? (["leftFoot","rightFoot"] as const).map(name=>{
      const bone=this.vrm.humanoid.getNormalizedBoneNode(name);
      return bone ? {bone,position:bone.getWorldPosition(new THREE.Vector3())} : null;
    }) : [];
    this.outputLimit.apply(delta);
    this.standingRecovery.confirmSettled();
    this.postIkError=solvedFeet.map(foot=>foot ? foot.bone.getWorldPosition(new THREE.Vector3()).distanceTo(foot.position) : 0);
    this.gaze.update(gazeTarget,delta);
    this.vrm.humanoid.update();
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.vrm.scene); }
}

/** Anatomical world frame: follows the torso, including VRM 0's corrected wrapper. */
function presentingFrame(vrm: VRM) {
  vrm.scene.updateMatrixWorld(true);
  const left=vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
  const right=vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
  const up=new THREE.Vector3(0,1,0);
  const lateral=left && right
    ? left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3())).normalize()
    : new THREE.Vector3(1,0,0).applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion()));
  const forward=lateral.clone().cross(up).normalize();
  up.crossVectors(forward,lateral).normalize();
  return {lateral,up,forward};
}

export function presentingHandTarget(vrm: VRM, side: "left"|"right", emphasis: boolean) {
  const upper=vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
  const lower=vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
  const hand=vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);
  if(!upper || !lower || !hand)return null;
  const {lateral,up,forward}=presentingFrame(vrm);
  const shoulder=upper.getWorldPosition(new THREE.Vector3());
  const elbow=lower.getWorldPosition(new THREE.Vector3());
  const length=shoulder.distanceTo(elbow)+elbow.distanceTo(hand.getWorldPosition(new THREE.Vector3()));
  // Emphasis opens BOTH arms diagonally down/out; explanation offers a palm in front.
  return shoulder.addScaledVector(lateral,(side==="left"?1:-1)*length*(emphasis?.82:.30))
    .addScaledVector(up,-length*(emphasis?.45:.42))
    .addScaledVector(forward,length*(emphasis?.20:.65));
}

export function aimArm(vrm: VRM, side: "left" | "right", target: THREE.Vector3, weight: number, handPose: "point" | "open" = "point") {
  const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
  const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
  const hand = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);
  if (!upper || !lower || !hand) return;
  const joints = [upper, lower];
  const original = joints.map(joint => joint.quaternion.clone());
  const world = new THREE.Quaternion(), parent = new THREE.Quaternion();
  const origin = new THREE.Vector3(), endpoint = new THREE.Vector3(), direction = new THREE.Vector3();
  vrm.scene.updateMatrixWorld(true);
  const shoulder=upper.getWorldPosition(new THREE.Vector3()), elbow=lower.getWorldPosition(new THREE.Vector3()), wrist=hand.getWorldPosition(new THREE.Vector3());
  const a=shoulder.distanceTo(elbow),b=elbow.distanceTo(wrist),baseReach=(a+b)*.84;
  const handGoal=handPose === "point"
    ? pointingHandGoal(shoulder,target,baseReach,(a+b)*.94)
    : target.clone().sub(shoulder).clampLength(Math.abs(a-b)+.0001,(a+b)*.94).add(shoulder);
  const reach=handGoal.distanceTo(shoulder);
  const axis=handGoal.clone().sub(shoulder).normalize();
  const frame=presentingFrame(vrm);
  const pole=handPose === "open"
    ? frame.up.clone().negate().addScaledVector(frame.forward,-.25).addScaledVector(frame.lateral,side==="left"?.2:-.2)
    : new THREE.Vector3(0,-1,.35).applyQuaternion(vrm.scene.quaternion);
  pole.addScaledVector(axis,-pole.dot(axis)).normalize();
  const along=(a*a-b*b+reach*reach)/(2*reach);
  const bentElbow=handPose === "point"
    ? pointingElbowGoal(shoulder,handGoal,target,a,b,pole)
    : shoulder.clone().addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(Math.max(0,a*a-along*along)));
  for (const [joint,child,goal] of [[upper,lower,bentElbow],[lower,hand,handGoal]] as const) {
    vrm.scene.updateMatrixWorld(true);
    joint.getWorldPosition(origin); child.getWorldPosition(endpoint);
    direction.copy(goal).sub(origin).normalize();
    world.setFromUnitVectors(endpoint.sub(origin).normalize(), direction);
    joint.parent?.getWorldQuaternion(parent);
    joint.quaternion.premultiply(parent.clone().invert().multiply(world).multiply(parent));
  }
  // Supinate the forearm, not the wrist: the sleeve follows the presenting palm.
  // Rotate around the actual forearm axis to preserve the solved hand position.
  if (handPose === "open" && hand.position.lengthSq() > 1e-8)
    lower.rotateOnAxis(hand.position.clone().normalize(), side === "left" ? .3 : -.3);
  joints.forEach((joint, i) => joint.quaternion.slerpQuaternions(original[i]!, joint.quaternion.clone(), weight));
  // The talk clip must not retain a bent wrist on top of the presenting pose.
  if(handPose === "open")hand.quaternion.slerp(new THREE.Quaternion(),weight);
  applyHandPose(vrm, handPose, side, weight);
  const indexBase = vrm.humanoid.getNormalizedBoneNode(`${side}IndexProximal`);
  const indexTip = vrm.humanoid.getNormalizedBoneNode(`${side}IndexDistal`);
  if (handPose === "point" && indexBase && indexTip) {
    const originalHand=hand.quaternion.clone();
    // Start from a neutral wrist. The arm solver carries the large directional
    // change; never fold the cuff to force an otherwise unreachable pointing ray.
    hand.quaternion.identity();
    vrm.scene.updateMatrixWorld(true);
    indexBase.getWorldPosition(origin); indexTip.getWorldPosition(endpoint);
    direction.copy(target).sub(origin).normalize();
    world.setFromUnitVectors(endpoint.sub(origin).normalize(), direction);
    const correction=world.angleTo(new THREE.Quaternion());
    if(correction>.7)world.slerpQuaternions(new THREE.Quaternion(),world.clone(),.7/correction);
    hand.parent?.getWorldQuaternion(parent);
    const aimed = hand.quaternion.clone().premultiply(parent.clone().invert().multiply(world).multiply(parent));
    hand.quaternion.slerpQuaternions(originalHand,aimed,weight);
  }
}


/** Estimate an in-place gait's full stride from each foot's fore/aft excursion. */
function estimateWalkDistance(vrm:VRM,clip:THREE.AnimationClip){
  const saved=Object.values(VRMHumanBoneName).flatMap(name=>{const bone=vrm.humanoid.getNormalizedBoneNode(name);return bone?[{bone,q:bone.quaternion.clone(),p:bone.position.clone()}]:[];});
  const mixer=new THREE.AnimationMixer(vrm.scene);const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const ranges=[[Infinity,-Infinity],[Infinity,-Infinity]];
  for(let i=0;i<=60;i++){action.paused=false;mixer.setTime(clip.duration*i/60);vrm.scene.updateMatrixWorld(true);
    (["leftFoot","rightFoot"] as const).forEach((name,index)=>{const bone=vrm.humanoid.getNormalizedBoneNode(name);if(!bone)return;const p=vrm.scene.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));ranges[index]![0]=Math.min(ranges[index]![0]!,p.z);ranges[index]![1]=Math.max(ranges[index]![1]!,p.z);});
  }
  mixer.stopAllAction();mixer.uncacheRoot(vrm.scene);saved.forEach(({bone,q,p})=>{bone.quaternion.copy(q);bone.position.copy(p);});vrm.scene.updateMatrixWorld(true);
  return THREE.MathUtils.clamp(ranges.reduce((sum,[min,max])=>sum+max!-min!,0),.35,2);
}
/** Express both rotation and pelvis travel in the root-yaw-free frame. */
export function removeTurnYaw(clip:THREE.AnimationClip,vrm:VRM){
  const result=clip.clone(),hips=vrm.humanoid.getNormalizedBoneNode("hips");
  const track=result.tracks.find(t=>t.name===`${hips?.name}.quaternion`);if(!track)return result;
  const q=new THREE.Quaternion(),yaw=new THREE.Quaternion(),e=new THREE.Euler(0,0,0,"YXZ");
  const position=result.tracks.find(t=>t.name===`${hips?.name}.position`),offset=new THREE.Vector3();
  for(let i=0;i<track.values.length;i+=4){
    q.fromArray(track.values,i);e.setFromQuaternion(q,"YXZ");yaw.setFromAxisAngle(new THREE.Vector3(0,1,0),-e.y);
    if(position && hips && position.times.length===track.times.length){
      const index=i/4*3;
      offset.fromArray(position.values,index).sub(hips.position).applyQuaternion(yaw).add(hips.position).toArray(position.values,index);
    }
    q.premultiply(yaw).toArray(track.values,i);
  }
  return result;
}
