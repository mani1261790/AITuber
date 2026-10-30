import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {quadraticFunctionsFixture} from '@aituber/content';
import type {CoursePackage} from '@aituber/contracts';
import {FixedResponseLlmProvider} from '@aituber/providers';
import {PreparedArtifacts} from './prepared-artifacts.ts';import {PreparedReadings} from './prepared-readings.ts';
import {createWholeLecturePlanner} from './whole-lecture-planner.ts';import {PackageEditorService} from './package-editor-service.ts';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
function setup(passed=true){
 const path=mkdtempSync(join(tmpdir(),'package-editor-'));cleanup.push(()=>rmSync(path,{recursive:true,force:true}));
 const artifacts=new PreparedArtifacts(path),readings=new PreparedReadings(()=>null,artifacts);
 const planner=createWholeLecturePlanner(()=>null,artifacts,readings);
 vi.spyOn(planner,'preparePackage').mockImplementation(async course=>({...course,performance:{version:1,units:course.schedule.orderedUnitIds.map(unitId=>({unitId,beats:[{text:course.teachingUnits.find(unit=>unit.id===unitId)!.speechText,targetId:null,camera:'lecture',position:'right',surface:'slides'}]})),readings:[]}}));
 let published=structuredClone(quadraticFunctionsFixture) as CoursePackage;
 const original=published;const provider=new FixedResponseLlmProvider([{passed,reason:'確認結果'}]);
 const service=new PackageEditorService(artifacts,planner,()=>provider,()=>published,course=>{published=course;},()=>{});
 return {service,planner,original,path,get published(){return published;}};
}
it('saves a separate draft, rejects stale writes, publishes a new version and restores it',async()=>{
 const t=setup(),id=t.original.id;const initial=t.service.get(id);
 const saved=t.service.save(id,{revision:initial.revision,course:{...initial.course,title:'編集した教材'}});
 expect(t.published.title).toBe(t.original.title);
 expect(()=>t.service.save(id,{revision:initial.revision,course:initial.course})).toThrow('別の画面');
 t.service.begin(id,saved.revision);
 expect(()=>t.service.save(id,{revision:saved.revision,course:saved.course})).toThrow('確認中');
 await t.service.runPendingStep();expect(t.service.get(id).error).toBeNull();expect(t.service.get(id).status).toBe('published');
 expect(t.published.version).toBe(t.original.version+1);expect(t.original.title).not.toBe(t.published.title);
 const register=vi.fn();new PackageEditorService(new PreparedArtifacts(t.path),t.planner,()=>{throw Error();},()=>t.original,register,()=>{});
 expect(register).toHaveBeenCalledWith(t.published);
});
it('review failure keeps the published version and editable draft',async()=>{
 const t=setup(false),id=t.original.id,draft=t.service.get(id);t.service.begin(id,draft.revision);await t.service.runPendingStep();
 expect(t.service.get(id).status).toBe('failed');expect(t.published).toEqual(t.original);expect(t.planner.preparePackage).not.toHaveBeenCalled();
});
it('stopping a queued publication prevents generation',async()=>{
 const t=setup(),id=t.original.id;t.service.begin(id,t.service.get(id).revision);t.service.stop(id);await t.service.runPendingStep();expect(t.planner.preparePackage).not.toHaveBeenCalled();expect(t.service.get(id).status).toBe('draft');
});
it('does not accept changed source rights',()=>{
 const t=setup(),draft=t.service.get(t.original.id);draft.course.sources[0]!.rights.basis='public-domain';expect(()=>t.service.save(t.original.id,{revision:draft.revision,course:draft.course})).toThrow('元資料');
});

it('restores an exactly matching published package without another generation or version',async()=>{
 const t=setup(),id=t.original.id;t.service.begin(id,t.service.get(id).revision);await t.service.runPendingStep();const original=structuredClone(t.published);const calls=vi.mocked(t.planner.preparePackage).mock.calls.length;
 const edited=t.service.save(id,{revision:t.service.get(id).revision,course:{...original,title:'temporary'}});expect(edited.status).toBe('draft');
 const restored=t.service.save(id,{revision:edited.revision,course:original});expect(restored.status).toBe('published');expect(restored.course).toEqual(original);
 t.service.begin(id,restored.revision);await t.service.runPendingStep();expect(t.planner.preparePackage).toHaveBeenCalledTimes(calls);expect(t.published.version).toBe(original.version);
});

it('reading previews do not modify the package or publish it and reject oversized input',async()=>{
 const t=setup(),id=t.original.id,before=t.service.get(id);
 const prepared={text:'テストです。',parts:[{text:'テストです。',reading:'テストデス。'}]};
 const get=vi.spyOn(PreparedReadings.prototype,'get').mockResolvedValue(prepared);
 const prepare=vi.spyOn(PreparedReadings.prototype,'prepare').mockResolvedValue();
 try{expect(await t.service.previewReadings(id,{texts:[prepared.text]})).toEqual([prepared]);expect(t.service.get(id)).toEqual(before);expect(t.published).toEqual(t.original);await expect(t.service.previewReadings(id,{texts:['x'.repeat(601)]})).rejects.toThrow('600');}finally{get.mockRestore();prepare.mockRestore();}
});

it('replaces source only with a matching available prepared package and preserves a backup',async()=>{
 const t=setup(),id=t.original.id;t.service.begin(id,t.service.get(id).revision);await t.service.runPendingStep();
 const before=t.service.get(id),next=structuredClone(before.course);
 next.sources[0]!.contentHash='sha256:'+'a'.repeat(64);next.title='Restored';for(const u of next.teachingUnits)u.teachingPlan={keyPoints:['説明'],explanationFlow:['説明する']};
 expect(()=>t.service.replaceReviewed(id,'stale',next)).toThrow('別の画面');
 expect(()=>t.service.replaceReviewed(id,before.revision,{...next,id:'other'})).toThrow('同じ教材ID');
 expect(()=>t.service.replaceReviewed(id,before.revision,{...next,status:'draft'})).toThrow('審査済み');
 const result=t.service.replaceReviewed(id,before.revision,next);
 expect(result.status).toBe('published');expect(result.course.version).toBe(before.course.version+1);expect(t.published.title).toBe('Restored');
 const store=new PreparedArtifacts(t.path);expect(store.read('source-replacement-backup:'+id+':'+before.revision)).toEqual(before);
 const register=vi.fn();new PackageEditorService(store,t.planner,()=>{throw Error();},()=>t.original,register,()=>{});expect(register).toHaveBeenCalledWith(result.course);
});
