import type {LessonAction,LessonDirectionView,ReadonlyCoursePackage} from '@aituber/contracts';
export interface RenderSpeech {file:string;durationMs:number;segments:{text:string;startMs:number;endMs:number}[]}
export interface RenderInput {course:ReadonlyCoursePackage;units:{id:string;actions:LessonAction[]}[];speeches:Record<string,RenderSpeech>;sourceUrls:Record<string,string>;fps:number}
export interface AudioPlacement {file:string;start:number;duration:number;offset?:number;gain?:number}
/** The only clock is the frame number. Wall time never advances lecture state. */
export class OfflineDirector {
 frame=0; unitIndex=0; index=0;version=0;done=false;waiting=false;stageDone=true;waitingUntil=0;
 direction:LessonDirectionView={actionId:'initial',phase:'resting',surface:'slides',position:'right',camera:'lecture',targetId:null,drawing:null,source:'generated',reason:null};
 speech:{text:string;start:number;data:RenderSpeech}|null=null;
 readonly audio:AudioPlacement[]=[];readonly trace:{frame:number;event:string;unit:string;text?:string}[]=[];
 private board:{main:string;arrived:boolean;mainStarted:boolean;introFinished:boolean;moving:boolean}|null=null;
 constructor(readonly input:RenderInput){}
 get time(){return this.frame/this.input.fps;}
 get unit(){return this.input.units[this.unitIndex]!;}
 private update(values:Partial<LessonDirectionView>){this.direction={...this.direction,...values};this.version++;}
 private speak(text:string){const data=this.input.speeches[text];if(!data)throw Error('Prepared voice missing');this.speech={text,start:this.time,data};this.audio.push({file:data.file,start:this.time,duration:data.durationMs/1000,gain:.8});this.trace.push({frame:this.frame,event:'speech',unit:this.unit.id,text});this.version++;}
 progress(id:string,writing?:boolean){if(id===this.direction.actionId&&writing&&this.board){this.board.arrived=true;this.beginBoard();}}
 complete(id:string){if(id!==this.direction.actionId)return;this.trace.push({frame:this.frame,event:'stage-complete',unit:this.unit.id});
  if(this.board&&!this.board.moving){this.board.moving=true;this.update({phase:'moving',position:'right'});return;}
  if(this.direction.phase==='projecting'&&this.direction.traveling){this.update({phase:'speaking'});return;}
  this.stageDone=true;this.update({phase:this.speech?'speaking':'resting',traveling:false});
 }
 private beginBoard(){const b=this.board;if(b&&!b.mainStarted&&b.arrived&&b.introFinished){b.mainStarted=true;this.update({boardNarrationReady:true});this.speak(b.main);}}
 advance(){
  if(this.done)return;
  if(this.speech&&this.time+1e-8>=this.speech.start+this.speech.data.durationMs/1000){this.speech=null;this.version++;if(this.board&&!this.board.mainStarted){this.board.introFinished=true;this.beginBoard();}}
  if(this.waiting){if(this.speech||!this.stageDone||this.time<this.waitingUntil||this.board&&!this.board.mainStarted)return;this.waiting=false;this.board=null;}
  for(let guard=0;guard<100;guard++){
   if(this.index>=this.unit.actions.length){this.unitIndex++;this.index=0;this.version++;if(this.unitIndex>=this.input.units.length){this.done=true;return;}this.trace.push({frame:this.frame,event:'page',unit:this.unit.id});}
   const action=this.unit.actions[this.index++]!;const id=`action-${this.unitIndex}-${this.index}`;this.update({actionId:id});this.trace.push({frame:this.frame,event:action.type,unit:this.unit.id});
   switch(action.type){
    case 'camera':this.update({camera:action.view});continue;
    case 'release_point':this.update({targetId:null});continue;
    case 'point_at':this.update({targetId:action.targetId,phase:'pointing'});this.waitingUntil=this.time+.55;break;
    case 'pause':this.waitingUntil=this.time+action.durationMs/1000;break;
    case 'move_to':if(this.direction.position===action.position)continue;this.update({position:action.position,phase:'moving'});this.stageDone=false;break;
    case 'show_slides':if(this.direction.surface==='slides')continue;this.update({surface:'slides',phase:'projecting'});this.stageDone=false;break;
    case 'speak':{const moving=Boolean(action.position&&action.position!==this.direction.position),projecting=action.surface==='slides'&&this.direction.surface!=='slides';this.update({phase:projecting?'projecting':'speaking',surface:action.surface??this.direction.surface??'slides',position:action.position??this.direction.position,gesture:action.gesture??'explain',traveling:moving});this.stageDone=!moving&&!projecting;this.speak(action.text);break;}
    case 'show_blackboard':{const rest=this.unit.actions.slice(this.index),at=rest.findIndex(a=>a.type==='speak');const next=rest[at];if(!next||next.type!=='speak')throw Error('Board explanation missing');this.index+=at+1;this.board={main:next.text,arrived:false,mainStarted:false,introFinished:!action.introduction,moving:false};this.stageDone=false;this.update({phase:'drawing',surface:'board',drawing:action.drawing,boardNarrationReady:!action.introduction,targetId:null});if(action.introduction)this.speak(action.introduction);break;}
   }
   this.waiting=true;return;
  }
  throw Error('Too many zero-duration actions');
 }
}
