// Local workerd benchmark entry only. Never referenced by production configuration.
import worker from '../../apps/cloudflare/src/index';
import {LectureRoom as ProductionRoom} from '../../apps/cloudflare/src/lecture-room';
export default {async fetch(request:Request,env:ConstructorParameters<typeof ProductionRoom>[1]){
 if(new URL(request.url).pathname.startsWith('/api/__')){try{return await env.ROOM.getByName('classroom-v1').fetch(request);}catch(error){return Response.json({error:String(error),stack:error instanceof Error?error.stack:''},{status:500});}}
 return worker.fetch(request,env);
}};
type Meter={cursors:{rowsRead:number;rowsWritten:number}[];kvReads:number;kvWrites:number;alarmWrites:number};
function bound(target:object,key:PropertyKey){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
function instrument(ctx:DurableObjectState,meter:Meter){
 const sql=new Proxy(ctx.storage.sql,{get(target,key){if(key==='exec')return (query:string,...args:unknown[])=>{const cursor=target.exec(query,...args);const count={rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten};meter.cursors.push(count);return new Proxy(cursor,{get(target,key){const value=bound(target,key);if(typeof value!=='function')return value;return (...args:unknown[])=>{try{return value(...args);}finally{count.rowsRead=cursor.rowsRead;count.rowsWritten=cursor.rowsWritten;}};}});};return bound(target,key);}});
 const kv=new Proxy(ctx.storage.kv,{get(target,key){if(['get','list','put','delete'].includes(String(key)))return (...args:unknown[])=>{if(key==='get'||key==='list')meter.kvReads++;else meter.kvWrites++;return bound(target,key)(...args);};return bound(target,key);}});
 Object.defineProperty(ctx.storage,'sql',{value:sql});
 Object.defineProperty(ctx.storage,'kv',{value:kv});
 for(const key of ['get','list','put','delete','setAlarm']){
  const original=bound(ctx.storage,key);
  Object.defineProperty(ctx.storage,key,{value:(...args:unknown[])=>{if(key==='get'||key==='list')meter.kvReads++;else if(key==='setAlarm'){meter.alarmWrites++;return Promise.resolve();}else meter.kvWrites++;return original(...args);}});
 }
 return ctx;
}
export class LectureRoom extends ProductionRoom {
 private meter:Meter;
 private real:DurableObjectState;
 constructor(ctx:DurableObjectState,env:ConstructorParameters<typeof ProductionRoom>[1]){
  const meter:Meter={cursors:[],kvReads:0,kvWrites:0,alarmWrites:0};super(instrument(ctx,meter),env);this.meter=meter;this.real=ctx;
 }
 override async fetch(request:Request){
  const path=new URL(request.url).pathname;
  if(path==='/api/__trip'){
   this.real.storage.kv.put('storage-safety-budget-v1',{day:new Date().toISOString().slice(0,10),reads:1_000_000,writes:0,requests:0});
   return Response.json({ok:true});
  }
  if(path==='/api/__recovery'){
   this.real.storage.kv.put('storage-safety-budget-v1',{day:'1999-01-01',reads:1_000_000,writes:0,requests:0});
   this.real.storage.kv.put('storage-safety-stopped',true);return Response.json({ok:true});
  }
  if(path==='/api/__meter'){
   const result={sqlReads:this.meter.cursors.reduce((n,c)=>n+c.rowsRead,0),sqlWrites:this.meter.cursors.reduce((n,c)=>n+c.rowsWritten,0),queries:this.meter.cursors.length,kvReads:this.meter.kvReads,kvWrites:this.meter.kvWrites,alarmWrites:this.meter.alarmWrites};
   this.meter.cursors=[];this.meter.kvReads=0;this.meter.kvWrites=0;this.meter.alarmWrites=0;
   return Response.json(result);
  }
  if(path==='/api/__scan_comparison'){
   const sql=this.real.storage.sql;
   // Temporary SQLite fixture with the same composite index as runtime_file_chunks.
   sql.exec('CREATE TABLE IF NOT EXISTS scan_fixture(path TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(path,part))');
   this.real.storage.transactionSync(()=>{for(let i=0;i<5000;i++)sql.exec('INSERT OR REPLACE INTO scan_fixture VALUES(?,?,?)',`/data/tts-cache/${i}`,0,new Uint8Array([1]));});
   const old=sql.exec("SELECT DISTINCT path FROM scan_fixture WHERE path LIKE '/data/authoring/sources/%'");old.toArray();
   const fixed=sql.exec('SELECT DISTINCT path FROM scan_fixture WHERE path >= ? AND path < ?','/data/authoring/sources/','/data/authoring/sources0');fixed.toArray();
   const result={fixtureRows:5000,oldReads:old.rowsRead,fixedReads:fixed.rowsRead};sql.exec('DROP TABLE scan_fixture');return Response.json(result);
  }
  if(path==='/api/__alarm'){await super.alarm();return Response.json({ok:true});}
  return super.fetch(request);
 }
}
