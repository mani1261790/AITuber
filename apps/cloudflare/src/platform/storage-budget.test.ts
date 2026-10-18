import {expect,it} from 'vitest';
import {StorageBudget,StorageSafetyLimit} from './storage-budget';
function fixture(){let now=Date.parse('2026-10-18T23:00:00Z');const values=new Map<string,unknown>();const kv={get:<T>(key:string)=>values.get(key) as T|undefined,put:(key:string,value:unknown)=>{values.set(key,structuredClone(value));}};return {kv,clock:()=>now,nextDay:()=>{now+=86400000;}};}
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
