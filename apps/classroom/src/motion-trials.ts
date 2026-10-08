export type MotionTrialStep = {file:string; seconds?:number|undefined};
export type MotionTrial = {id:string; label:string; steps:MotionTrialStep[]};
const step=(file:string,seconds?:number|undefined):MotionTrialStep=>({file:`/models/motions/research/${file}.vrma`,seconds});
const h=(name:string,seconds?:number|undefined)=>step(`hanami/${name}`,seconds);
export const motionTrials:MotionTrial[]=[
  {id:"walk-sequence",label:"Overte · 歩き始め → 歩行 → 停止",steps:[h("idle",2),h("world-walk-start"),h("world-walk",4),h("world-walk-stop-small"),h("idle",3)]},
  {id:"point-sequence",label:"Overte · 腕を上げる → 指す → 戻す",steps:[h("idle",2),h("world-point-in"),h("world-point-hold",4),h("world-point-out"),h("idle",3)]},
  {id:"talk-sequence",label:"Overte · 待機 → 会話 → 頷き → 待機",steps:[h("idle",2),h("idle-talking",7.1),h("nod"),h("idle",3)]},
  ...([
    ["idle","待機 A"],["idle-2","待機 B"],["idle-talking","会話 A・指あり"],["idle-talking-4","会話 B・指あり"],
    ["nod","頷き"],["think","考える"],["world-walk-start","歩き始め"],["world-walk","歩行"],["world-walk-stop-small","停止"],
    ["world-point-in","指差し・開始"],["world-point-hold","指差し・維持"],["world-point-out","指差し・終了"]
  ] as const).map(([id,label])=>({id,label:`Overte · ${label}`,steps:[h(id)]})),
  {id:"sachi-idle",label:"Sachi · 待機",steps:[step("sachi/idle-01")]},
  {id:"sachi-talk",label:"Sachi · 会話",steps:[step("sachi/speaking-01")]},
];
