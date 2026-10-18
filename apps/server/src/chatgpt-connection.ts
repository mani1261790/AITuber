import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from '@aituber/runtime-platform/files';
import { dirname } from 'node:path';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { CHATGPT_MODEL, ChatGptLlmProvider } from '@aituber/providers';
import type { ChatGptConnectionView } from '@aituber/contracts';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
interface Credentials { mode?: 'local' | 'web'; idToken?: string; accessToken: string; refreshToken: string; expiresAt: number; scopes: string[]; subject: string; email: string; clientId: string }
interface Attempt { state: string; nonce: string; verifier: string; browserHash: string; expiresAt: number; clientId: string; redirectUri: string }
interface Saved { hostId: string; credentials?: Credentials; pending?: Attempt }
export interface ChatGptConfig { clientId: string; redirectUri: string; clientSecret?: string; planUsageEnabled: boolean }
export class ChatGptAuthError extends TypeError {}
export async function verifyChatGptIdentity(token: string, clientId: string, nonce: string, key: JWTVerifyGetKey = jwks): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, key, { issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
  if (payload.nonce !== nonce) throw new ChatGptAuthError('ChatGPTの認証nonceが一致しません。');
  return payload;
}
type Verify = (token: string, clientId: string, nonce: string) => Promise<JWTPayload>;

/** One operator connection. Credentials remain in private runtime storage. */
export class ChatGptConnection {
  private saved: Saved;
  private refreshing: Promise<string> | null = null;
  private epoch = 0;
  constructor(private readonly path: string, private readonly config: ChatGptConfig, private readonly fetcher: typeof fetch = fetch,
    private readonly verify: Verify = verifyChatGptIdentity) {
    this.saved = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Saved : { hostId: `urn:uuid:${crypto.randomUUID()}` };
    this.persist();
  }

  view(): ChatGptConnectionView {
    const credentials = this.activeCredentials();
    const configured = this.configured();
    return { status: credentials ? 'connected' : configured ? 'disconnected' : 'local-authorization-required',
      model: CHATGPT_MODEL, email: credentials?.email ?? null,
      message: credentials ? 'ChatGPTプランの利用枠を使用します。認証の更新と文章生成はCloudflare側で行います。' : configured ? 'ChatGPTで接続すると、教材・台本・板書を生成できます。' : '初回だけMacで認証します。その後はMacを終了してもCloudflareで生成できます。' };
  }

  private activeCredentials(): Credentials | undefined {
    const credentials = this.saved.credentials;
    return credentials && (credentials.mode === 'local' || this.configured() && credentials.clientId === this.config.clientId) ? credentials : undefined;
  }

  async importLocal(input: { clientId: string; nonce: string; tokens: Record<string, unknown>; savedAt: number }): Promise<void> {
    if (!input || !/^oaiapp_[\w-]+$/.test(input.clientId) || typeof input.nonce !== 'string' || input.nonce.length < 32 || !input.tokens || typeof input.tokens.id_token !== 'string' || !Number.isFinite(input.savedAt) || input.savedAt > Date.now() + 30_000 || Date.now() - input.savedAt > 30 * 60_000) throw new ChatGptAuthError('Macで新しく認証した接続情報を使用してください。');
    const epoch = ++this.epoch;
    const identity = await this.verify(input.tokens.id_token, input.clientId, input.nonce);
    if (typeof identity.sub !== 'string' || !identity.sub) throw new ChatGptAuthError('ChatGPTのアカウントを確認できませんでした。');
    const credentials = this.credentials(input.tokens, { subject: identity.sub, email: typeof identity.email === 'string' ? identity.email : '', clientId: input.clientId });
    credentials.expiresAt -= Math.max(0, Date.now() - input.savedAt);
    if (credentials.expiresAt <= Date.now() + 60_000) throw new ChatGptAuthError('認証情報の期限が近いため、Macで認証をやり直してください。');
    credentials.mode = 'local'; credentials.idToken = input.tokens.id_token;
    await this.checkModel(credentials.accessToken);
    if (epoch !== this.epoch) throw new ChatGptAuthError('接続状態が変更されました。再認証してください。');
    this.saved.credentials = credentials; delete this.saved.pending; this.persist();
  }

  private configured(): boolean {
    try { const url = new URL(this.config.redirectUri); return this.config.planUsageEnabled && /^oaiapp_[\w-]+$/.test(this.config.clientId) && url.protocol === 'https:' && url.pathname === '/auth/chatgpt/callback' && !url.search && !url.hash && !url.username && !url.password; }
    catch { return false; }
  }

  async start(origin: string): Promise<{ url: string; browserToken: string }> {
    if (!this.configured()) throw new ChatGptAuthError('OpenAIでAITuber用のWeb OAuthクライアントとChatGPTプラン利用を登録してください。');
    if (new URL(this.config.redirectUri).origin !== origin) throw new ChatGptAuthError('登録済みコールバックURLと接続元が一致しません。');
    const browserToken = randomBytes(32).toString('base64url');
    const attempt: Attempt = { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), browserHash: hash(browserToken), expiresAt: Date.now() + 600_000, clientId: this.config.clientId, redirectUri: this.config.redirectUri };
    this.saved.pending = attempt; this.persist();
    const url = new URL(`${issuer}/api/accounts/authorize`);
    url.search = new URLSearchParams({ client_id: attempt.clientId, redirect_uri: attempt.redirectUri, response_type: 'code', scope, resource, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: hash(attempt.verifier), ext_agent_host_id: this.saved.hostId }).toString();
    return { url: url.toString(), browserToken };
  }

  async complete(url: URL, browserToken: string): Promise<void> {
    const attempt = this.saved.pending;
    if (!attempt || !browserToken || attempt.browserHash !== hash(browserToken) || attempt.state !== url.searchParams.get('state') || attempt.expiresAt < Date.now()) throw new ChatGptAuthError('認証の有効期限が切れたか、開始したブラウザと異なります。接続をやり直してください。');
    delete this.saved.pending; this.persist(); // Consume before the first network await.
    if (url.searchParams.has('error')) throw new ChatGptAuthError('ChatGPT接続がキャンセルされました。');
    if (url.origin + url.pathname !== attempt.redirectUri || attempt.clientId !== this.config.clientId || url.searchParams.has('client_id') && url.searchParams.get('client_id') !== attempt.clientId) throw new ChatGptAuthError('ChatGPTの認証先が一致しません。');
    const code = url.searchParams.get('code');
    if (!code) throw new ChatGptAuthError('認証コードがありません。接続をやり直してください。');
    const epoch = ++this.epoch;
    const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri });
    if (typeof tokens.id_token !== 'string') throw new ChatGptAuthError('ChatGPTのIDトークンがありません。');
    const identity = await this.verify(tokens.id_token, attempt.clientId, attempt.nonce);
    if (typeof identity.sub !== 'string' || !identity.sub) throw new ChatGptAuthError('ChatGPTのアカウントを確認できませんでした。');
    const credentials = this.credentials(tokens, { subject: identity.sub, email: typeof identity.email === 'string' ? identity.email : '', clientId: attempt.clientId });
    await this.checkModel(credentials.accessToken);
    if (epoch !== this.epoch) throw new ChatGptAuthError('接続状態が変更されました。接続をやり直してください。');
    this.saved.credentials = credentials; this.persist();
  }

  provider(): ChatGptLlmProvider {
    if (this.view().status !== 'connected') throw new ChatGptAuthError('LLM接続でChatGPTに接続してください。');
    return new ChatGptLlmProvider(() => this.accessToken());
  }

  async checkModel(token = ''): Promise<void> {
    const response = await this.fetcher(`${resource}/models`, { headers: { authorization: `Bearer ${token || await this.accessToken()}` }, signal: AbortSignal.timeout(30_000) });
    const body = await boundedJson(response);
    if (!response.ok) throw new ChatGptAuthError(`ChatGPTのモデル一覧を取得できませんでした（HTTP ${response.status}）。プラン利用の許可を確認してください。`);
    if (!Array.isArray(body.models) || !body.models.some((model: unknown) => typeof model === 'object' && model !== null && 'slug' in model && model.slug === CHATGPT_MODEL)) throw new ChatGptAuthError('このChatGPT接続ではgpt-6-lunaが利用できません。別のモデルへの自動切り替えは行いません。');
  }

  async accessToken(forceRefresh = false): Promise<string> {
    const credentials = this.activeCredentials();
    if (!credentials) throw new ChatGptAuthError('ChatGPTに再接続してください。');
    if (!forceRefresh && credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken;
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch;
    this.refreshing = (async () => {
      try {
        const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken }, credentials.clientId, credentials.mode !== 'local');
        const next = this.credentials(tokens, credentials);
        if (epoch !== this.epoch) throw new ChatGptAuthError('ChatGPTの接続状態が変更されました。');
        this.saved.credentials = next; this.persist(); return next.accessToken;
      } catch {
        if (epoch === this.epoch) { delete this.saved.credentials; this.persist(); }
        throw new ChatGptAuthError('ChatGPTの接続を更新できませんでした。再接続してください。');
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  async disconnect(): Promise<boolean> {
    const credentials = this.saved.credentials;
    ++this.epoch; delete this.saved.credentials; delete this.saved.pending; this.persist();
    if (!credentials) return true;
    try {
      const response = await this.fetcher(`${issuer}/api/accounts/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credentials.refreshToken, token_type_hint: 'refresh_token', client_id: credentials.clientId }), signal: AbortSignal.timeout(15_000) });
      await response.body?.cancel(); return response.ok;
    } catch { return false; }
  }

  private async tokenRequest(fields: Record<string, string>, clientId = this.config.clientId, confidential = true): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (confidential && this.config.clientSecret) {
      const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
      headers.authorization = `Basic ${Buffer.from(`${encode(clientId)}:${encode(this.config.clientSecret)}`).toString('base64')}`;
    }
    const response = await this.fetcher(`${issuer}/api/accounts/oauth/token`, { method: 'POST', headers, body: new URLSearchParams({ ...fields, client_id: clientId, resource }), signal: AbortSignal.timeout(30_000) });
    const body = await boundedJson(response);
    if (!response.ok) throw new ChatGptAuthError(`ChatGPTの認証に失敗しました（HTTP ${response.status}）。接続をやり直してください。`);
    return body;
  }

  private credentials(tokens: Record<string, unknown>, previous: Pick<Credentials, 'subject' | 'email' | 'clientId'> & Partial<Credentials>): Credentials {
    const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ') : previous.scopes ?? [];
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : previous.refreshToken;
    if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw new ChatGptAuthError('ChatGPTプラン利用が許可されていません。');
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || !refreshToken || typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') throw new ChatGptAuthError('ChatGPTの認証応答が不正です。');
    return { ...(previous.mode ? { mode: previous.mode } : {}), ...(previous.idToken ? { idToken: previous.idToken } : {}), subject: previous.subject, email: previous.email, clientId: previous.clientId, accessToken: tokens.access_token, refreshToken, expiresAt: Date.now() + tokens.expires_in * 1000, scopes };
  }

  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.saved), { encoding: 'utf8', mode: 0o600 }); renameSync(tmp, this.path);
  }
}
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new ChatGptAuthError('ChatGPTから認証応答がありません。');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new ChatGptAuthError('ChatGPTの応答が大きすぎます。'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}
