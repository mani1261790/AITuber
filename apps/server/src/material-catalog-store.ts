import {defaultMaterialGroups,type MaterialCatalog} from '@aituber/contracts';
import {PreparedArtifacts} from './prepared-artifacts.ts';
export class MaterialCatalogStore {
 constructor(private store:PreparedArtifacts){}
 get():MaterialCatalog{return this.store.read<MaterialCatalog>('material-catalog')??{revision:0,groups:structuredClone(defaultMaterialGroups),entries:[]};}
 save(input:unknown,lookup:(id:string)=>unknown):MaterialCatalog{
  const value=input as MaterialCatalog;
  if(!value||!Number.isSafeInteger(value.revision)||!Array.isArray(value.groups)||!Array.isArray(value.entries)||value.groups.length<1||value.groups.length>30||value.entries.length>1000)throw new TypeError('分類と教材の指定を確認してください');
  const valid=(v:unknown,n:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
  const ids=new Set<string>(),labels=new Set<string>();
  for(const g of value.groups){if(!g||!valid(g.id,80)||!/^[-a-zA-Z0-9]+$/.test(g.id)||!valid(g.label,40)||ids.has(g.id)||labels.has(g.label.trim()))throw new TypeError('分類名は重複しない40文字以内で指定してください');ids.add(g.id);labels.add(g.label.trim());}
  if(!ids.has('other'))throw new TypeError('その他の分類は残してください');
  const courses=new Set<string>();
  for(const e of value.entries){if(!e||!valid(e.id,200)||courses.has(e.id)||!ids.has(e.groupId)||!valid(e.title,160)||typeof e.previous!=='boolean')throw new TypeError('教材の分類・表示名を確認してください');lookup(e.id);courses.add(e.id);}
  const current=this.get();if(current.revision!==value.revision)throw new TypeError('別の画面で整理されています。最新の一覧を読み直してください');
  const next:MaterialCatalog={revision:current.revision+1,groups:value.groups.map(g=>({id:g.id,label:g.label.trim()})),entries:value.entries.map(e=>({id:e.id,groupId:e.groupId,title:e.title.trim(),previous:e.previous}))};
  this.store.write('material-catalog',next);return next;
 }
}
