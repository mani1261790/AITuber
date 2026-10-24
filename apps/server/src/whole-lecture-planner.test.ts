import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FixedResponseLlmProvider} from '@aituber/providers';
import {quadraticFunctionsFixture} from '@aituber/content';import {LectureEventStore} from '@aituber/storage';
import {FixedLectureService} from './fixed-lecture-service.ts';import {PreparedArtifacts,digest} from './prepared-artifacts.ts';import {PreparedReadings} from './prepared-readings.ts';
import {createWholeLecturePlanner,applyScriptPatch,type LectureScript,type ScriptUnit} from './whole-lecture-planner.ts';import type {Beat} from './lesson-director.ts';
const resources:(()=>void)[]=[];afterEach(()=>resources.splice(0).reverse().forEach(close=>close()));
const beat=(text:string):Beat=>({text,targetId:null,surface:'slides',camera:'lecture',position:'right',gesture:'explain',walkWhileSpeaking:false,blackboardMarkdown:null});
function setup(){
 const directory=mkdtempSync(join(tmpdir(),'whole-lecture-'));resources.push(()=>rmSync(directory,{recursive:true,force:true}));
 const events=new LectureEventStore(':memory:');resources.push(()=>events.close());const service=new FixedLectureService({store:events,waitForClassroom:true});resources.push(()=>service.close());
 const session=service.createSession({coursePackageId:quadraticFunctionsFixture.id,durationMinutes:15});
 const units:ScriptUnit[]=session.course.schedule.orderedUnitIds.map(id=>{const unit=session.course.teachingUnits.find(unit=>unit.id===id)!;return {unitId:id,beats:[beat(unit.speechText)]};});
 const artifacts=new PreparedArtifacts(directory);const readings=new PreparedReadings(()=>null,artifacts);vi.spyOn(readings,'prepare').mockResolvedValue();
 const input={session,unit:session.course.teachingUnits.find(unit=>unit.id===units[0]!.unitId)!,previousSpeech:'',remainingMs:900000};
 return {directory,artifacts,readings,input,units};
}
it('generates and reviews the whole lecture once, then executes all units and restores from disk without LLM calls',async()=>{
 const t=setup();const provider=new FixedResponseLlmProvider([{units:t.units},{passed:true,reason:'verified'}]);const planner=createWholeLecturePlanner(()=>provider,t.artifacts,t.readings);
 for(const unit of t.input.session.course.teachingUnits.filter(unit=>t.input.session.course.schedule.orderedUnitIds.includes(unit.id)))expect((await planner({...t.input,unit},new AbortController().signal)).source).toBe('generated');
 expect(provider.calls.map(call=>call.purpose)).toEqual(['generation','review']);
 expect(t.readings.prepare).toHaveBeenCalledTimes(1);expect(t.readings.prepare).toHaveBeenCalledWith(t.units.map(unit=>unit.beats[0]!.text),expect.anything(),expect.anything());
 const restored=createWholeLecturePlanner(()=>null,new PreparedArtifacts(t.directory),t.readings);
 expect((await restored(t.input,new AbortController().signal)).source).toBe('generated');
});
it('keeps an unchanged continuation after a question without regenerating its text or readings',async()=>{
 const t=setup();const provider=new FixedResponseLlmProvider([{units:t.units},{passed:true,reason:'verified'},{baseRevision:digest(t.units),replacements:[]}]);const planner=createWholeLecturePlanner(()=>provider,t.artifacts,t.readings);
 await planner(t.input,new AbortController().signal);
 const input={...t.input,questionAnswer:'括弧の符号について答えました。'};
 const plan=await planner(input,new AbortController().signal);await planner(input,new AbortController().signal);
 expect(provider.calls).toHaveLength(3);expect(plan.actions).toContainEqual(expect.objectContaining({type:'speak',text:t.units[0]!.beats[0]!.text}));expect(t.readings.prepare).toHaveBeenCalledTimes(1);
});
it('applies only guarded unplayed replacements and rejects stale, duplicate and completed edits',()=>{
 const t=setup();const base:LectureScript={version:1,key:'test',revision:digest(t.units),units:t.units,handledAnswers:[]};const first=t.units[0]!;
 const replacement={unitId:first.unitId,expectedHash:digest(first),beats:[beat('修正した説明です。')]};const patch={baseRevision:base.revision,replacements:[replacement]};
 const changed=applyScriptPatch(base,patch,new Set([first.unitId]));expect(changed.units[1]).toEqual(base.units[1]);expect(changed.revision).not.toBe(base.revision);expect(base.units[0]).toEqual(first);
 expect(()=>applyScriptPatch(base,patch,new Set())).toThrow('再生済み');
 expect(()=>applyScriptPatch(changed,patch,new Set([first.unitId]))).toThrow('古い');
 expect(()=>applyScriptPatch(base,{...patch,replacements:[replacement,replacement]},new Set([first.unitId]))).toThrow('対象外');
});
it('repairs a failed whole-script review by guarded replacement rather than regenerating every unit',async()=>{
 const t=setup();const first=t.units[0]!;const provider=new FixedResponseLlmProvider([{units:t.units},{passed:false,reason:'Inspect first unit'},{baseRevision:digest(t.units),replacements:[{...first,expectedHash:digest(first)}]},{passed:true,reason:'verified'}]);
 await createWholeLecturePlanner(()=>provider,t.artifacts,t.readings)(t.input,new AbortController().signal);
 expect(provider.calls.map(call=>call.purpose)).toEqual(['generation','review','generation','review']);
});
it('refuses incomplete unit coverage instead of falling back to independent unit generation',async()=>{
 const t=setup();const provider=new FixedResponseLlmProvider([{units:t.units.slice(1)}]);
 await expect(createWholeLecturePlanner(()=>provider,t.artifacts,t.readings)(t.input,new AbortController().signal)).rejects.toThrow('網羅性');expect(provider.calls).toHaveLength(1);
});
it('reviews and persists an answer patch, preparing readings only for its changed unit',async()=>{
 const t=setup(),first=t.units[0]!;const replacement={unitId:first.unitId,expectedHash:digest(first),beats:[beat(first.beats[0]!.text+'ここではこの関係を使います。')]};
 const provider=new FixedResponseLlmProvider([{units:t.units},{passed:true,reason:'verified'},{baseRevision:digest(t.units),replacements:[replacement]},{passed:true,reason:'verified'}]);
 const planner=createWholeLecturePlanner(()=>provider,t.artifacts,t.readings);await planner(t.input,new AbortController().signal);
 const input={...t.input,questionAnswer:'平方完成の理由を説明しました。'};const changed=await planner(input,new AbortController().signal);
 expect(changed.actions).toContainEqual(expect.objectContaining({type:'speak',text:replacement.beats[0]!.text}));
 expect(t.readings.prepare).toHaveBeenLastCalledWith([replacement.beats[0]!.text],expect.anything(),expect.anything());
 const restored=createWholeLecturePlanner(()=>null,new PreparedArtifacts(t.directory),t.readings);
 expect(await restored(input,new AbortController().signal)).toEqual(changed);
 expect(provider.calls).toHaveLength(4);
});
it('never publishes an aborted preparation as a saved complete script',async()=>{
 const t=setup();const provider=new FixedResponseLlmProvider([{units:t.units},{passed:true,reason:'verified'}]);const controller=new AbortController();
 const pending=createWholeLecturePlanner(()=>provider,t.artifacts,t.readings)(t.input,controller.signal);controller.abort();
 await expect(pending).rejects.toBeDefined();
 await expect(createWholeLecturePlanner(()=>null,new PreparedArtifacts(t.directory),t.readings)(t.input,new AbortController().signal)).rejects.toThrow('未接続');
});
it('repairs a deterministic content defect with a patch before publishing the full script',async()=>{
 const t=setup(),first=t.units[0]!;
 const course={...t.input.session.course,teachingUnits:t.input.session.course.teachingUnits.map(unit=>unit.id===first.unitId?{...unit,speakingGuidance:{requiredPhrases:['必須の表現'],avoidPhrases:[],explanationNotes:''}}:unit)};
 const input={...t.input,session:{...t.input.session,course},unit:course.teachingUnits.find(unit=>unit.id===first.unitId)!};
 const replacement={unitId:first.unitId,expectedHash:digest(first),beats:[beat(first.beats[0]!.text+'必須の表現です。')]};
 const provider=new FixedResponseLlmProvider([{units:t.units},{baseRevision:digest(t.units),replacements:[replacement]},{passed:true,reason:'verified'}]);
 const plan=await createWholeLecturePlanner(()=>provider,t.artifacts,t.readings)(input,new AbortController().signal);
 expect(plan.actions).toContainEqual(expect.objectContaining({type:'speak',text:replacement.beats[0]!.text}));expect(provider.calls).toHaveLength(3);
});
