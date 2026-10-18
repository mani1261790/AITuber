import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ChatGptConnection, verifyChatGptIdentity } from './chatgpt-connection.ts';

const config = { clientId: 'oaiapp_aituber', redirectUri: 'https://aituber.example/auth/chatgpt/callback', planUsageEnabled: true };
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tokens = { access_token: 'access-test', refresh_token: 'refresh-test', id_token: 'id-test', expires_in: 3600, token_type: 'Bearer', scope: 'openid resource.invoke chatgpt.tokens.use.direct offline_access' };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aituber-chatgpt-')); directories.push(dir);
  const path = join(dir, 'connection.json');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/models') ? Response.json({ models: [{ slug: 'gpt-6-luna', visibility: 'list' }] }) : Response.json(tokens));
  const verify = vi.fn().mockResolvedValue({ sub: 'operator-1', email: 'test@example.com' });
  const connection = new ChatGptConnection(path, config, fetcher, verify);
  return { path, fetcher, verify, connection };
}
async function authorize(connection: ChatGptConnection) {
  const attempt = await connection.start('https://aituber.example');
  const state = new URL(attempt.url).searchParams.get('state')!;
  const callback = new URL(config.redirectUri); callback.search = new URLSearchParams({ code: 'code-test', state }).toString();
  return { attempt, callback };
}
describe('ChatGPT operator connection', () => {
  it('keeps unregistered clients inactive and never uses dynamic registration on a hosted callback', async () => {
    const { path } = fixture();
    const connection = new ChatGptConnection(path, { ...config, clientId: '' });
    expect(connection.view().status).toBe('local-authorization-required');
    await expect(connection.start('https://aituber.example')).rejects.toThrow('登録');
    expect(() => connection.provider()).toThrow('接続');
  });
  it('binds authorization to browser/state and consumes the callback once', async () => {
    const { connection, fetcher, path } = fixture();
    const { attempt, callback } = await authorize(connection);
    const query = new URL(attempt.url).searchParams;
    expect(query.get('code_challenge_method')).toBe('S256'); expect(query.get('scope')).toContain('chatgpt.tokens.use.direct');
    await expect(connection.complete(callback, 'wrong')).rejects.toThrow('ブラウザ'); expect(fetcher).not.toHaveBeenCalled();
    await connection.complete(callback, attempt.browserToken);
    expect(connection.view()).toMatchObject({ status: 'connected', model: 'gpt-6-luna', email: 'test@example.com' });
    expect(JSON.stringify(connection.view())).not.toContain('access-test');
    expect(JSON.parse(readFileSync(path, 'utf8')).pending).toBeUndefined();
    await expect(connection.complete(callback, attempt.browserToken)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects expired state, denied consent and wrong returned client IDs without exchanging a code', async () => {
    for (const kind of ['expired', 'denied', 'client']) {
      const { path, connection, fetcher } = fixture(); const { attempt, callback } = await authorize(connection);
      let active = connection;
      if (kind === 'expired') { const data = JSON.parse(readFileSync(path, 'utf8')); data.pending.expiresAt = 0; writeFileSync(path, JSON.stringify(data)); active = new ChatGptConnection(path, config, fetcher); }
      if (kind === 'denied') callback.searchParams.set('error', 'access_denied');
      if (kind === 'client') callback.searchParams.set('client_id', 'oaiapp_other');
      await expect(active.complete(callback, attempt.browserToken)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('does not activate identity-only grants or accounts without Luna', async () => {
    for (const kind of ['scope', 'model', 'identity']) {
      const { connection, fetcher, verify } = fixture(); const { attempt, callback } = await authorize(connection);
      if (kind === 'scope') fetcher.mockResolvedValueOnce(Response.json({ ...tokens, scope: 'openid' }));
      if (kind === 'model') fetcher.mockResolvedValueOnce(Response.json(tokens)).mockResolvedValueOnce(Response.json({ models: [{ slug: 'other' }] }));
      if (kind === 'identity') verify.mockRejectedValueOnce(new Error('bad signature'));
      await expect(connection.complete(callback, attempt.browserToken)).rejects.toThrow(); expect(connection.view().status).toBe('disconnected');
    }
  });
  it('serializes rotating refresh tokens, persists the replacement and stops after disconnect', async () => {
    const { path, connection, fetcher, verify } = fixture(); const { attempt, callback } = await authorize(connection); await connection.complete(callback, attempt.browserToken);
    const saved = JSON.parse(readFileSync(path, 'utf8')); saved.credentials.expiresAt = 0; writeFileSync(path, JSON.stringify(saved));
    fetcher.mockClear(); fetcher.mockResolvedValue(Response.json({ ...tokens, access_token: 'new-access', refresh_token: 'new-refresh' }));
    const restored = new ChatGptConnection(path, config, fetcher, verify);
    expect(await Promise.all([restored.accessToken(), restored.accessToken()])).toEqual(['new-access', 'new-access']);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(readFileSync(path, 'utf8')).credentials.refreshToken).toBe('new-refresh');
    fetcher.mockResolvedValue(new Response(null, { status: 200 })); await restored.disconnect();
    await expect(restored.accessToken()).rejects.toThrow('再接続'); expect(JSON.parse(readFileSync(path, 'utf8')).credentials).toBeUndefined();
  });
  it('imports a local grant without partner registration and refreshes with its issued client ID', async () => {
    const { path, fetcher, verify } = fixture();
    const connection = new ChatGptConnection(path, { clientId: '', redirectUri: '', planUsageEnabled: false }, fetcher, verify);
    const hostId = JSON.parse(readFileSync(path, 'utf8')).hostId;
    await connection.importLocal({ clientId: 'oaiapp_local', nonce: 'n'.repeat(32), savedAt: Date.now(), tokens });
    expect(connection.view().status).toBe('connected');
    expect(JSON.parse(readFileSync(path, 'utf8')).hostId).toBe(hostId);
    fetcher.mockClear(); fetcher.mockResolvedValueOnce(Response.json({ ...tokens, access_token: 'rotated' }));
    expect(await connection.accessToken(true)).toBe('rotated');
    expect(new URLSearchParams(String(fetcher.mock.calls[0]![1]!.body)).get('client_id')).toBe('oaiapp_local');
    const restored = new ChatGptConnection(path, { clientId: '', redirectUri: '', planUsageEnabled: false }, fetcher, verify);
    expect(restored.view().status).toBe('connected'); expect(await restored.accessToken()).toBe('rotated');
  });
  it('rejects stale imports before replacing an existing connection', async () => {
    const { connection } = fixture(); const { attempt, callback } = await authorize(connection); await connection.complete(callback, attempt.browserToken);
    await expect(connection.importLocal({clientId:'oaiapp_local',nonce:'n'.repeat(32),tokens,savedAt:0})).rejects.toThrow('新しく');
    expect(connection.view().status).toBe('connected');
  });
  it('verifies signed identity, issuer, audience, expiry and nonce', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const key = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test' }] });
    const sign = (issuer = 'https://auth.openai.com', audience = config.clientId, expiry: string | number = '5m') => new SignJWT({ nonce: 'expected' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('operator').setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
    const token = await sign(); expect((await verifyChatGptIdentity(token, config.clientId, 'expected', key)).sub).toBe('operator');
    await expect(verifyChatGptIdentity(token, config.clientId, 'wrong', key)).rejects.toThrow();
    for (const invalid of [await sign('https://wrong.example'), await sign(undefined, 'other'), await sign(undefined, undefined, 1)]) await expect(verifyChatGptIdentity(invalid, config.clientId, 'expected', key)).rejects.toThrow();
    const other = await generateKeyPair('RS256'); const wrongKey = createLocalJWKSet({ keys: [{ ...await exportJWK(other.publicKey), kid: 'test' }] });
    await expect(verifyChatGptIdentity(token, config.clientId, 'expected', wrongKey)).rejects.toThrow();
  });
});

it('binds default token/catalog fetch to the Worker global receiver', async () => {
  const original = globalThis.fetch;
  const {path} = fixture();
  globalThis.fetch = async function(this: unknown) {
    expect(this).toBe(globalThis);
    return Response.json({models:[{slug:'gpt-6-luna'}]});
  };
  try { await new ChatGptConnection(path,config).checkModel('test'); }
  finally { globalThis.fetch = original; }
});
