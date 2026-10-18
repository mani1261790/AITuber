import { LlmProviderError, parseAndValidate, validateRequest, type LlmProvider, type LlmContext, type LlmResult, type StructuredGenerationRequest } from './llm.ts';

export const CHATGPT_MODEL = 'gpt-6-luna';
const endpoint = 'https://api.openai.com/v1/responses';

/** Uses a dedicated SIWC grant, never a Codex credential or a ChatGPT backend endpoint. */
export class ChatGptLlmProvider implements LlmProvider {
  constructor(private readonly accessToken: () => Promise<string>, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly timeoutMs = 180_000) {}

  createContext(options: { purpose: LlmContext['purpose']; systemInstruction: string }): LlmContext {
    return { purpose: options.purpose, generate: <T>(request: StructuredGenerationRequest<T>) => this.generate(options.systemInstruction, request) };
  }

  private async generate<T>(instructions: string, request: StructuredGenerationRequest<T>): Promise<LlmResult<T>> {
    validateRequest(request);
    const started = performance.now();
    const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(request.signal ? [request.signal] : [])]);
    try {
      signal.throwIfAborted();
      const token = await this.accessToken();
      signal.throwIfAborted();
      const response = await this.fetcher(endpoint, {
        method: 'POST', signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: CHATGPT_MODEL, instructions, store: false, stream: true,
          input: [{ role: 'user', content: [{ type: 'input_text', text: request.prompt }, ...(request.images ?? []).map(image => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.dataBase64}` }))] }],
          text: { format: { type: 'json_schema', name: request.schemaName, schema: request.schema, strict: false } },
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new LlmProviderError('provider_error', response.status === 401 ? 'ChatGPTに再接続してください。' : response.status === 403 ? 'AITuberへのChatGPTプラン利用が許可されていません。' : response.status === 429 ? 'ChatGPTの利用上限に達しました。利用状況を確認してください。' : `ChatGPT returned HTTP ${response.status}`);
      }
      const envelope = await readResponsesStream(response, request.maxOutputBytes ?? 1_000_000);
      const value = parseAndValidate<T>(envelope.text, request.schema, request.validate);
      const inputTokens = count(envelope.usage.input_tokens), outputTokens = count(envelope.usage.output_tokens);
      return { value, model: CHATGPT_MODEL, provider: 'chatgpt', latencyMs: performance.now() - started,
        usage: { inputTokens, outputTokens, totalTokens: count(envelope.usage.total_tokens), estimatedCostUsd: null } };
    } catch (error) {
      if (signal.aborted) throw new LlmProviderError(request.signal?.aborted ? 'cancelled' : 'timeout', request.signal?.aborted ? '生成を中止しました。' : 'ChatGPTの生成がタイムアウトしました。');
      if (error instanceof LlmProviderError) throw error;
      // Never propagate transport errors containing credentials or request details.
      throw new LlmProviderError('provider_error', 'ChatGPTの接続または生成結果を確認できませんでした。再接続してください。');
    }
  }
}

function count(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

export async function readResponsesStream(response: Response, limit: number): Promise<{ text: string; usage: Record<string, unknown> }> {
  if (!response.body) throw new LlmProviderError('provider_error', 'ChatGPTの応答本文がありません。');
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    // Some gateways deliver the completed Responses envelope as JSON even with stream:true.
    const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > limit * 2 + 65536) throw new LlmProviderError('response_too_large', 'ChatGPTの応答がサイズ上限を超えました。');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const buffer = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    const decoded = new TextDecoder().decode(buffer);
    if (/^(?:event:|data:|:)/.test(decoded.trimStart())) return readResponsesStream(new Response(decoded,{headers:{'content-type':'text/event-stream'}}),limit);
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(decoded)); }
    catch { throw new LlmProviderError('provider_error', 'ChatGPTからJSONでもイベントストリームでもない応答が返りました。'); }
    const result = envelope.type === 'response.completed' ? record(envelope.response) : envelope;
    if (result.status !== 'completed') {
      const safe = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(v) ? v : 'unknown';
      throw new LlmProviderError('provider_error', `ChatGPTの応答が未完了です（type=${safe(envelope.type ?? envelope.object)}, status=${safe(result.status)}, code=${safe(record(result.error).code)}, fields=${Object.keys(envelope).filter(key=>/^[a-zA-Z0-9_]{1,40}$/.test(key)).slice(0,12).join(',')}）。`);
    }
    const text = (Array.isArray(result.output) ? result.output : []).flatMap(item => Array.isArray(record(item).content) ? record(item).content as unknown[] : []).filter(item => record(item).type === 'output_text').map(item => record(item).text).filter((value): value is string => typeof value === 'string').join('');
    if (new TextEncoder().encode(text).byteLength > limit) throw new LlmProviderError('response_too_large', 'ChatGPTの生成結果がサイズ上限を超えました。');
    return { text, usage: record(result.usage) };
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', text = '', complete = false, bytes = 0, outputBytes = 0;
  let usage: Record<string, unknown> = {};
  const accept = (frame: string) => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = record(JSON.parse(data));
    if (event.type === 'response.failed' || event.type === 'error' || event.type === 'response.incomplete') {
      const code = record(record(event.response).error).code;
      throw new LlmProviderError('provider_error', code === 'subscription_sharing_usage_limit_exceeded' ? 'ChatGPTの利用上限に達しました。利用状況を確認してください。' : code === 'subscription_sharing_usage_unavailable' ? 'ChatGPTプランの利用が許可されていません。再接続してください。' : 'ChatGPTの生成が完了しませんでした。');
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      outputBytes += new TextEncoder().encode(event.delta).byteLength;
      if (outputBytes > limit) throw new LlmProviderError('response_too_large', 'ChatGPTの生成結果がサイズ上限を超えました。');
      text += event.delta;
    }
    if (event.type === 'response.completed') { complete = true; usage = record(record(event.response).usage); }
  };
  try {
    while (!complete) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit * 64 + 65536) throw new LlmProviderError('response_too_large', 'ChatGPTストリームがサイズ上限を超えました。');
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > limit * 2 + 65536) throw new LlmProviderError('response_too_large', 'ChatGPTイベントがサイズ上限を超えました。');
      // Normalize only complete frames, preserving CRLF across network chunks.
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        accept(pending.slice(0, match.index).replace(/\r\n/g, '\n'));
        pending = pending.slice(match.index + match[0].length);
        if (complete) break;
      }
    }
    if (!complete) throw new LlmProviderError('invalid_response', 'ChatGPTの応答が完了前に切断されました。');
    return { text, usage };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
