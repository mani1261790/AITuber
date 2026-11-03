import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import type {CoursePackage} from '@aituber/contracts';
import {VideoExportService,compileExportUnits} from './video-export-service.ts';
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
const fixture=()=>JSON.parse(readFileSync(new URL('../../../fixtures/pdf-media/course.json',import.meta.url),'utf8')) as CoursePackage;
it('restores slides across unit boundaries after a blackboard explanation',()=>{
 const course=fixture(),first=course.performance!.units[0]!.beats[0]!,second=course.performance!.units[1]!.beats[0]!;
 first.surface='board';first.blackboardMarkdown='説明';first.boardReason='補足';first.media=[];
 second.surface='slides';second.blackboardMarkdown=null;second.targetId=null;
 const units=compileExportUnits(course);
 expect(units[0]!.actions.some(a=>a.type==='show_blackboard')).toBe(true);
 expect(units[1]!.actions.some(a=>a.type==='speak'&&a.surface==='slides')).toBe(true);
});
it('aborts preparation and keeps cancelled jobs from being downloadable',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'aituber-export-'));dirs.push(directory);
 let aborted=false;
 const service=new VideoExportService({directory,repo:process.cwd(),getCourse:fixture,readSource:()=>new Uint8Array(),voiceId:'test',speech:{provider:"test",model:"test",async synthesize(_request,{signal}){return await new Promise((_resolve,reject)=>{signal?.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));});});}}});
 const job=service.start('test');expect(()=>service.start('test')).toThrow('別のMP4');
 expect(()=>service.dir('../outside')).toThrow();
 service.cancel(job.id);await new Promise(r=>setTimeout(r,10));expect(aborted).toBe(true);expect(service.get(job.id).status).toBe('cancelled');
 expect(()=>service.download(job.id,{} as Parameters<VideoExportService['download']>[1])).toThrow('まだ完成');
});
it('records preparation failure without silently retrying or launching a worker',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'aituber-export-'));dirs.push(directory);let calls=0;
 const service=new VideoExportService({directory,repo:process.cwd(),getCourse:fixture,readSource:()=>new Uint8Array(),voiceId:'test',speech:{provider:'test',model:'test',async synthesize(){calls++;throw Error('voice unavailable');}}});
 const job=service.start('test');await new Promise(r=>setTimeout(r,10));expect(service.get(job.id)).toMatchObject({status:'failed',error:'voice unavailable'});expect(calls).toBe(1);
});
