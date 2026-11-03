import {randomUUID,createHash} from 'node:crypto';import {mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,createReadStream,openSync,closeSync} from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import type {ServerResponse} from 'node:http';
import type {ReadonlyCoursePackage,BlackboardDrawing} from '@aituber/contracts';import type {TextToSpeechProvider} from '@aituber/providers';import {compileBeats,actionSpeechTexts} from './lesson-director.ts';import {PreparedArtifacts} from './prepared-artifacts.ts';import {PreparedReadings,ReadingSpeechProvider} from './prepared-readings.ts';
export interface ExportJob {id:string;courseId:string;title:string;status:'preparing'|'rendering'|'encoding'|'complete'|'failed'|'cancelled';frames:number;createdAt:string;updatedAt:string;error?:string;pid?:number;duration?:number}
export class VideoExportService {
 readonly #preparing=new Map<string,AbortController>();
 constructor(readonly options:{directory:string;repo:string;getCourse:(id:string)=>ReadonlyCoursePackage;readSource:(hash:string)=>Uint8Array;speech:TextToSpeechProvider;voiceId:string}){mkdirSync(options.directory,{recursive:true});}
 list(){return readdirSync(this.options.directory).filter(id=>/^export\.[a-f0-9-]+$/.test(id)).map(id=>this.get(id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 get(id:string):ExportJob {const job=JSON.parse(readFileSync(path.join(this.dir(id),'status.json'),'utf8')) as ExportJob;if(['preparing','rendering','encoding'].includes(job.status)&&!this.#preparing.has(id)&&job.pid){try{process.kill(job.pid,0);}catch{job.status='failed';job.error='書き出しプロセスが停止しました。再度開始してください。';this.save(job);}}return job;}
 dir(id:string){if(!/^export\.[a-f0-9-]{36}$/.test(id))throw new TypeError('Invalid export id');return path.join(this.options.directory,id);}
 private save(job:ExportJob){const file=path.join(this.dir(job.id),'status.json');writeFileSync(file+'.tmp',JSON.stringify({...job,updatedAt:new Date().toISOString()}));renameSync(file+'.tmp',file);}
 start(courseId:string){if(this.list().some(j=>['preparing','rendering','encoding'].includes(j.status)))throw new TypeError('別のMP4を書き出しています。完了を待ってください。');const course=JSON.parse(JSON.stringify(this.options.getCourse(courseId))) as ReadonlyCoursePackage;if(!course.performance||course.durationMinutes>30)throw new TypeError('台本を保存した30分以内の教材を指定してください');
 const job:ExportJob={id:'export.'+randomUUID(),courseId:course.id,title:course.title,status:'preparing',frames:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),pid:process.pid};mkdirSync(this.dir(job.id));this.save(job);const controller=new AbortController();this.#preparing.set(job.id,controller);void this.prepare(job,course,controller).catch(e=>{const current=this.get(job.id);if(current.status!=='cancelled')this.save({...current,status:'failed',error:e instanceof Error?e.message:String(e)});}).finally(()=>this.#preparing.delete(job.id));return job;}
 cancel(id:string){const job=this.get(id);if(!['complete','failed','cancelled'].includes(job.status)){writeFileSync(path.join(this.dir(id),'cancel'),'');this.#preparing.get(id)?.abort();this.save({...job,status:'cancelled'});}return this.get(id);}
 download(id:string,response:ServerResponse){const job=this.get(id);if(job.status!=='complete')throw new TypeError('MP4はまだ完成していません');response.setHeader('content-type','video/mp4');response.setHeader('content-disposition',`attachment; filename="lecture.mp4"; filename*=UTF-8''${encodeURIComponent(job.title+'.mp4')}`);const stream=createReadStream(path.join(this.dir(id),'lecture.mp4'));stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response);}
 private async prepare(job:ExportJob,course:ReadonlyCoursePackage,controller:AbortController){const dir=this.dir(job.id);const units=compileExportUnits(course);
 const sources:Record<string,string>={};let n=0;for(const source of course.sources){if(source.kind!=='pdf')continue;const name=`source-${n++}.pdf`;writeFileSync(path.join(dir,name),this.options.readSource(source.contentHash));sources[source.id]='/job/'+name;}
 const speech=new ReadingSpeechProvider(this.options.speech,new PreparedReadings(()=>null,new PreparedArtifacts(path.join(dir,'readings'))),()=>course.pronunciationDictionary,()=>course.performance!.readings);
 const speeches:Record<string,unknown>={};let total=0;
 for(const text of new Set(units.flatMap(u=>actionSpeechTexts(u.actions)))){controller.signal.throwIfAborted();const artifact=await speech.synthesize({text,language:'ja-JP',voiceId:this.options.voiceId,dictionaryVersion:'sha256:'+createHash('sha256').update(JSON.stringify(course.pronunciationDictionary)).digest('hex')},{signal:controller.signal});const name=`voice-${Object.keys(speeches).length}.audio`;writeFileSync(path.join(dir,name),artifact.audio);speeches[text]={file:name,durationMs:artifact.durationMs,segments:artifact.segments};total+=artifact.durationMs;if(total>1800000)throw Error('音声が30分を超えています');}
 controller.signal.throwIfAborted();writeFileSync(path.join(dir,'input.json'),JSON.stringify({course,units,speeches,sourceUrls:sources,fps:30}));
 const log=openSync(path.join(dir,'worker.log'),'a');try{const child=spawn(process.execPath,[path.join(this.options.repo,'scripts/render-mp4-worker.mjs'),dir],{cwd:this.options.repo,detached:true,stdio:['ignore',log,log],env:{...process.env,AITUBER_RENDER_REPO:this.options.repo}});if(!child.pid)throw Error('描画プロセスを開始できません');this.save({...job,status:'rendering',pid:child.pid});child.on('error',e=>this.save({...job,status:'failed',error:e.message}));child.unref();}finally{closeSync(log);}
 }
}

/** Carry the stage across units, just as a continuous lecture does. */
export function compileExportUnits(course:ReadonlyCoursePackage){
 let board:BlackboardDrawing|undefined;let surface:'slides'|'board'='slides';
 return course.schedule.orderedUnitIds.map(id=>{
  const script=course.performance?.units.find(u=>u.unitId===id);if(!script)throw Error('保存済みの台本がありません');
  const actions=compileBeats(JSON.parse(JSON.stringify(script.beats)),board,surface);
  for(const action of actions){if(action.type==='show_blackboard'){board=action.drawing;surface='board';}else if(action.type==='show_slides'||action.type==='speak'&&action.surface==='slides'){board=undefined;surface='slides';}}
  return {id,actions};
 });
}
