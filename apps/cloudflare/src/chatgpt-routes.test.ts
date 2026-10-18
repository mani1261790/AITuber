import { describe, it, expect, vi } from 'vitest';
vi.mock('./lecture-room', () => ({ LectureRoom: class {} }));
import worker, { type AppEnv } from './index';
import { issueSession } from './auth';
describe('ChatGPT route boundaries', () => {
  it('requires operator auth and same-origin POSTs to start and disconnect', async () => {
    const forwarded = vi.fn().mockResolvedValue(Response.json({}));
    const env = { OPERATOR_PASSWORD: 'test', ROOM: { getByName: () => ({ fetch: forwarded }) } } as unknown as AppEnv;
    const base = 'https://aituber.example';
    const cookie = `__Host-aituber=${await issueSession('test')}`;
    for (const action of ['start', 'disconnect', 'check', 'import']) {
      const url = `${base}/api/settings/llm/chatgpt/${action}`;
      expect((await worker.fetch(new Request(url, { method: 'POST', headers: { origin: base } }), env)).status).toBe(401);
      expect((await worker.fetch(new Request(url, { method: 'POST', headers: { origin: 'https://other.example', cookie } }), env)).status).toBe(403);
      expect(forwarded).not.toHaveBeenCalled();
    }
    await worker.fetch(new Request(`${base}/api/settings/llm/chatgpt/start`, { method: 'POST', headers: { origin: base, cookie } }), env);
    expect(forwarded).toHaveBeenCalledOnce();
  });
  it('forwards callback only to the transaction verifier without requiring the Strict operator cookie', async () => {
    const forwarded = vi.fn().mockResolvedValue(new Response('verified by DO'));
    const env = { OPERATOR_PASSWORD: 'test', ROOM: { getByName: () => ({ fetch: forwarded }) } } as unknown as AppEnv;
    const response = await worker.fetch(new Request('https://aituber.example/auth/chatgpt/callback?code=test', { headers: { cookie: '__Host-aituber-oauth=transaction', authorization: 'untrusted' } }), env);
    expect(response.status).toBe(200);
    const request = forwarded.mock.calls[0]![0] as Request;
    expect(request.headers.get('cookie')).toContain('transaction'); expect(request.headers.get('authorization')).toBeNull();
  });
});
