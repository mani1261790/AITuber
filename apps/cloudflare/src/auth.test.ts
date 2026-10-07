import {describe,it,expect} from 'vitest';
import {authenticated,issueSession,sameOrigin,sameSecret} from './auth.ts';
describe('cloud operator boundary',()=>{
 it('accepts only a signed unexpired cookie',async()=>{
  const secret='test-secret';const now=10000;const token=await issueSession(secret,now);
  const req=(value:string)=>new Request('https://aituber.example/Operator',{headers:{cookie:`__Host-aituber=${value}`}});
  expect(await authenticated(req(token),secret,now)).toBe(true);
  expect(await authenticated(req(token),'other',now)).toBe(false);
  expect(await authenticated(req(token),secret,now+8*86400_000)).toBe(false);
  expect(await authenticated(req(token.replace(/^\d+/, '99999999999999')),secret,now)).toBe(false);
  expect(await authenticated(new Request('https://aituber.example'),secret)).toBe(false);
 });
 it('rejects empty credentials and cross-origin mutations',async()=>{
  expect(await sameSecret('','')).toBe(false);
  expect(await sameSecret('one','two')).toBe(false);
  expect(sameOrigin(new Request('https://aituber.example',{headers:{origin:'https://other.example'}}))).toBe(false);
  expect(sameOrigin(new Request('https://aituber.example',{headers:{origin:'https://aituber.example'}}))).toBe(true);
 });
});
