export interface MotionPack {id:string;label:string;file:string;files?:Record<string,string>;license?:string}
export const motionPacks:MotionPack[] = [
  {
    "id": "quaternius",
    "label": "Quaternius — 歩行・説明",
    "file": "quaternius/UAL1_Standard_RM.glb"
  },
  {
    "id": "addon",
    "label": "Mesh2Motion — 待機・反応",
    "file": "mesh2motion/human-addon-animations.glb"
  },
  {
    "id": "mocap",
    "label": "Mesh2Motion — 方向転換",
    "file": "mesh2motion/human-mocap-animations.glb"
  },
  {
    "id": "rokoko",
    "label": "Rokoko — 実収録の説明・指差し",
    "file": "",
    "files": {
      "Idle_Pointing_MIXAMO_769": "rokoko/Idle_Pointing_MIXAMO_769.fbx",
      "Idle_Conversation_Loop_MIXAMO_769_segment-2": "rokoko/Idle_Conversation_Loop_MIXAMO_769_segment-2.fbx",
      "Idle_WatchingSomething_Loop_MIXAMO_769_segment": "rokoko/Idle_WatchingSomething_Loop_MIXAMO_769_segment.fbx"
    },
    "license": "無料・Rokoko利用条件（CC0ではありません）"
  }
];
export const recommendedMotions:Record<string,string[]> = {
  "quaternius": [
    "Walk_Loop",
    "Walk_Formal_Loop",
    "Idle_Loop",
    "Idle_Talking_Loop"
  ],
  "addon": [
    "Walk_Female",
    "Walk_Backwards",
    "Strafe_left",
    "Strafe_right",
    "Idle_Subtle",
    "Idle Listening",
    "Greeting",
    "Head Nod",
    "Bow"
  ],
  "mocap": [
    "Turn_Left_90",
    "Turn_Right_90",
    "Turn_Left_180",
    "Turn_Right_180"
  ],
  "rokoko": [
    "Idle_Pointing_MIXAMO_769",
    "Idle_Conversation_Loop_MIXAMO_769_segment-2",
    "Idle_WatchingSomething_Loop_MIXAMO_769_segment"
  ]
};
export type HandPose = "original"|"relaxed"|"point"|"open";
export const motionLabels:Record<string,string>={
 Walk_Loop:"通常歩行",Walk_Formal_Loop:"姿勢を正した歩行",Jog_Fwd_Loop:"ジョギング",Idle_Loop:"待機",Idle_Talking_Loop:"話す",Interact:"手を伸ばす",PickUp_Table:"机から拾う",Sitting_Enter:"座る",Sitting_Idle_Loop:"座って待機",Sitting_Talking_Loop:"座って話す",Sitting_Exit:"立ち上がる",
 Walk:"通常歩行",Walk_Formal:"姿勢を正した歩行",Walk_Carry:"物を持って歩く",Idle_A:"待機",Idle_Talking:"話す",Idle_FoldArms:"腕を組む",Idle_ShakeOff:"体をほぐす",Yes:"うなずく",
 Walk_Female:"女性向け歩行",Walk_Large:"大きな歩行",Walk_Backwards:"後ろ歩き",Strafe_left:"左へ横歩き",Strafe_right:"右へ横歩き",Idle_Subtle:"控えめな待機","Idle Listening":"聞く",Greeting:"挨拶","Head Nod":"うなずく",Confused:"考え込む",Bow:"お辞儀",Reject:"否定する",
 Turn_Left_90:"左へ90度",Turn_Right_90:"右へ90度",Turn_Left_180:"左へ180度",Turn_Right_180:"右へ180度",Salute:"敬礼",Help_One_Arm:"片手を上げる",
};
Object.assign(motionLabels,{Idle_Pointing_MIXAMO_769:"指差し（実収録）",
"Idle_Conversation_Loop_MIXAMO_769_segment-2":"会話・説明（実収録）",Idle_WatchingSomething_Loop_MIXAMO_769_segment:"見守る・聞く（実収録）"});
export const allowedMotionFiles=()=>motionPacks.flatMap(pack=>pack.files?Object.values(pack.files):[pack.file]);
