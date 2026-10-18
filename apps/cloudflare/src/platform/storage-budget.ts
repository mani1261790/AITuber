/** Conservative, persisted per-namespace safety limits, well below the free account limits. */
export const STORAGE_LIMITS={reads:1_000_000,writes:20_000,requests:30_000} as const;
export const STORAGE_SAFETY_MESSAGE='無料枠を保護するため、本日の処理を停止しました。日本時間の午前9時以降に更新してください。';
type Usage={day:string;reads:number;writes:number;requests:number};
export class StorageSafetyLimit extends Error {
 constructor(){super('AITUBER_STORAGE_SAFETY_LIMIT');}
}
export class StorageBudget {
 private usage!:Usage;
 private reserved!:Usage;
 private tripped=false;
 private recovery=false;
 constructor(private readonly kv:Pick<DurableObjectStorage['kv'],'get'|'put'>,private readonly now=()=>Date.now(),private readonly onStop=()=>{}){this.load();}
 private day(){return new Date(this.now()).toISOString().slice(0,10);}
 private load(){const day=this.day();const saved=this.kv.get<Usage>('storage-safety-budget-v1');this.usage=saved?.day===day?{...saved}:{day,reads:0,writes:0,requests:0};this.reserved={...this.usage};this.recovery=this.kv.get<boolean>('storage-safety-stopped')===true;this.tripped=false;}
 check(){if(this.usage.day!==this.day())this.load();if(this.usage.reads>=STORAGE_LIMITS.reads||this.usage.writes>=STORAGE_LIMITS.writes||this.usage.requests>=STORAGE_LIMITS.requests){if(!this.tripped){this.kv.put('storage-safety-stopped',true);this.tripped=true;this.onStop();}throw new StorageSafetyLimit();}}
 needsRecovery(){return this.recovery;}
 recovered(){this.kv.put('storage-safety-stopped',false);this.recovery=false;}
 request(){this.check();this.usage.requests++;this.save();}
 record(reads:number,writes:number){this.usage.reads+=reads;this.usage.writes+=writes;this.save();}
 flush(){
  // SQL transaction rollbacks may also roll back an in-transaction reservation.
  // Recommit the conservative totals outside the operation, once per admitted request.
  this.kv.put('storage-safety-budget-v1',this.reserved);
  if(this.tripped)this.kv.put('storage-safety-stopped',true);
 }
 private save(){
  const next={day:this.usage.day,reads:Math.ceil(this.usage.reads/1000)*1000,writes:Math.ceil(this.usage.writes/100)*100,requests:Math.ceil(this.usage.requests/100)*100};
  if(next.reads===this.reserved.reads&&next.writes===this.reserved.writes&&next.requests===this.reserved.requests&&next.day===this.reserved.day)return;
  // Reserve ahead, so a restart charges unused reservation instead of losing usage.
  this.kv.put('storage-safety-budget-v1',next);this.reserved=next;
 }
 wrap(storage:DurableObjectStorage):DurableObjectStorage{
  const check=()=>this.check();
  const recordUsage=(reads:number,writes:number)=>this.record(reads,writes);
  const sql=new Proxy(storage.sql,{get(target,key){
   if(key!=='exec'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
   return (query:string,...bindings:unknown[])=>{
    check();const cursor=target.exec(query,...bindings);let reads=0,writes=0;
    const record=()=>{recordUsage(cursor.rowsRead-reads,cursor.rowsWritten-writes);reads=cursor.rowsRead;writes=cursor.rowsWritten;};record();
    const wrapped:typeof cursor=new Proxy(cursor,{get(target,key){
     if(key===Symbol.iterator)return ()=>wrapped;
     if(key==='raw')return function*(){try{for(const row of target.raw()){record();yield row;}}finally{record();}};
     const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args:unknown[])=>{try{return value.apply(target,args);}finally{record();}};
    }});
    return wrapped;
   };
  }});
  return new Proxy(storage,{get(target,key){if(key==='sql')return sql;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 }
}
