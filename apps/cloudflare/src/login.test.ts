import {describe,it,expect,vi} from 'vitest';
vi.mock('./lecture-room',()=>({LectureRoom:class {}}));
import worker, {type AppEnv} from './index';
import {authenticated} from './auth';
const base='https://aituber.example';
const env={OPERATOR_PASSWORD:'test-password'} as AppEnv;
const submit=(password:string,origin=base)=>worker.fetch(new Request(base+'/login',{method:'POST',headers:{origin},body:new URLSearchParams({password})}),env);
describe('native login form',()=>{
 it('preserves the form origin on initial and failed login pages',async()=>{
  for(const response of [await worker.fetch(new Request(base+'/login'),env),await submit('wrong')]){
   expect(response.headers.get('referrer-policy')).toBe('same-origin');
   expect(response.headers.get('cache-control')).toBe('no-store');
   expect(await response.text()).toContain('<form method="post"');
  }
 });
 it('reports a wrong password and accepts a correct retry',async()=>{
  const failure=await submit('wrong');expect(failure.status).toBe(401);
  expect(await failure.text()).toContain('パスワードが違います');
  const success=await submit(env.OPERATOR_PASSWORD);
  expect(success.status).toBe(303);expect(success.headers.get('location')).toBe('/operator/');
  expect(await authenticated(new Request(base+'/operator/',{headers:{cookie:success.headers.get('set-cookie')!.split(';')[0]!}}),env.OPERATOR_PASSWORD)).toBe(true);
 });
 it('still rejects null and external origins with a readable recovery page',async()=>{
  for(const origin of ['null','https://other.example']){
   const response=await submit(env.OPERATOR_PASSWORD,origin);expect(response.status).toBe(403);
   expect(response.headers.get('set-cookie')).toBeNull();
   expect(await response.text()).toContain('ログイン画面を再読み込み');
  }
 });
});
