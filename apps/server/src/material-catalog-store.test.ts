import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PreparedArtifacts} from './prepared-artifacts.ts';import {MaterialCatalogStore} from './material-catalog-store.ts';
const paths:string[]=[];afterEach(()=>paths.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function setup(){const path=mkdtempSync(join(tmpdir(),'catalog-'));paths.push(path);return {path,store:new MaterialCatalogStore(new PreparedArtifacts(path))};}
it('persists ordered metadata without changing lesson packages and rejects stale edits',()=>{
 const {path,store}=setup(),initial=store.get(),lookup=vi.fn(()=>({title:'original'}));
 const saved=store.save({...initial,groups:[...initial.groups,{id:'new',label:'自主学習'}],entries:[{id:'b',groupId:'new',title:'表示名',previous:false},{id:'a',groupId:'other',title:'旧版',previous:true}]},lookup);
 expect(saved.revision).toBe(1);expect(new MaterialCatalogStore(new PreparedArtifacts(path)).get()).toEqual(saved);expect(lookup.mock.calls).toHaveLength(2);
 expect(()=>store.save(initial,lookup)).toThrow('別の画面');expect(store.get()).toEqual(saved);
});
it('rejects duplicate or missing groups, unknown courses, malformed booleans and duplicate entries',()=>{
 const {store}=setup(),base=store.get();const e={id:'a',groupId:'other',title:'教材',previous:false};
 for(const input of [{...base,groups:[]},{...base,groups:[...base.groups,base.groups[0]]},{...base,entries:[e,e]},{...base,entries:[{...e,groupId:'missing'}]},{...base,entries:[{...e,previous:'false'}]}])expect(()=>store.save(input,()=>({}))).toThrow();
 expect(()=>store.save({...base,entries:[e]},()=>{throw new RangeError('Unknown course');})).toThrow('Unknown course');expect(store.get().revision).toBe(0);
});
