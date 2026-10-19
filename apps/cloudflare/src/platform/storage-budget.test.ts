import {expect,it} from 'vitest';
import {StorageBudget,StorageSafetyLimit} from './storage-budget';
function fixture(){let now=Date.parse('2026-10-18T23:00:00Z');const values=new Map<string,unknown>();const kv={get:<T>(key:string)=>values.get(key) as T|undefined,put:(key:string,value:unknown)=>{values.set(key,structuredClone(value));}};return {kv,values,clock:()=>now,nextDay:()=>{now+=86400000;}};}
it('persists reservations across restarts and resets only on the UTC day boundary',()=>{
 const f=fixture();const budget=new StorageBudget(f.kv,f.clock);budget.record(999_001,0);
 const restored=new StorageBudget(f.kv,f.clock);expect(()=>restored.check()).toThrow(StorageSafetyLimit);
 f.nextDay();expect(()=>restored.request()).not.toThrow();expect(restored.needsRecovery()).toBe(true);
 restored.recovered();expect(new StorageBudget(f.kv,f.clock).needsRecovery()).toBe(false);
});
it('stops requests and writes before the platform daily limits',()=>{
 const f=fixture();const budget=new StorageBudget(f.kv,f.clock);for(let i=0;i<30_000;i++)budget.request();expect(()=>budget.request()).toThrow(StorageSafetyLimit);
 f.nextDay();budget.check();budget.record(0,20_000);expect(()=>budget.check()).toThrow(StorageSafetyLimit);
});
it('does not turn completed requests into 100 requests each after restarts',()=>{
 const f=fixture();
 for(let i=0;i<500;i++){
  const budget=new StorageBudget(f.kv,f.clock);
  budget.request();budget.flush();
 }
 expect(new StorageBudget(f.kv,f.clock).snapshot().usage.requests).toBe(500);
});
it('does not charge unused SQL reservations again after completed operations',()=>{
 const f=fixture();
 for(let i=0;i<300;i++){
  const budget=new StorageBudget(f.kv,f.clock);
  budget.check();budget.record(10,1);budget.flush();
 }
 const state=new StorageBudget(f.kv,f.clock).snapshot();
 expect(state.usage.reads).toBe(3000);expect(state.usage.writes).toBe(300);
});

it('reconciles only the confirmed incident and preserves the recovery stop',()=>{
 const f=fixture();f.nextDay();
 const original={day:'2026-10-19',reads:194_000,writes:20_000,requests:19_500};
 f.kv.put('storage-safety-budget-v1',original);f.kv.put('storage-safety-stopped',true);
 const budget=new StorageBudget(f.kv,f.clock);expect(()=>budget.check()).not.toThrow();
 expect(budget.snapshot().usage).toEqual({day:'2026-10-19',reads:50_000,writes:10_000,requests:2000});
 expect(budget.needsRecovery()).toBe(true);
 expect(f.kv.get<{original:unknown}>('storage-safety-reconciliation-2026-10-19')?.original).toEqual(original);
 budget.request();budget.flush();
 expect(new StorageBudget(f.kv,f.clock).snapshot().usage.requests).toBe(2001);
 f.kv.put('storage-safety-budget-v1',{...original,reads:194_001});
 expect(()=>new StorageBudget(f.kv,f.clock).check()).toThrow(StorageSafetyLimit);
});
