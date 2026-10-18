import { describe, it, expect, vi } from 'vitest';
import { ChatGptLlmProvider, readResponsesStream } from './chatgpt.ts';

const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
function stream(frames: string, split = 7): Response {
  const bytes = new TextEncoder().encode(frames);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
const request = { prompt: '二次関数を説明', schemaName: 'test', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } };
describe('ChatGPT plan Responses provider', () => {
  it('uses Luna, instructions, image input and supported fields; validates completed JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream(event({ type: 'response.output_text.delta', delta: '{"title":"平方完成"}' }) + event({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } })));
    const provider = new ChatGptLlmProvider(async () => 'oauth-test', fetcher);
    const result = await provider.createContext({ purpose: 'generation', systemInstruction: '教える' }).generate({ ...request, images: [{ mimeType: 'image/png', dataBase64: 'AA==' }] });
    expect(result.value).toEqual({ title: '平方完成' }); expect(result.provider).toBe('chatgpt'); expect(result.usage.totalTokens).toBe(30); expect(result.usage.estimatedCostUsd).toBeNull();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, stream: true, instructions: '教える' });
    expect(body.input[0].content[1].type).toBe('input_image');
    for (const field of ['max_output_tokens', 'temperature', 'messages', 'previous_response_id']) expect(body).not.toHaveProperty(field);
  });
  it('rejects a partial stream even if the JSON is already valid', async () => {
    await expect(readResponsesStream(stream(event({ type: 'response.output_text.delta', delta: '{}' })), 100)).rejects.toThrow('完了前');
  });
  it('rejects mid-stream quota failure and incomplete terminal events', async () => {
    await expect(readResponsesStream(stream(event({ type: 'response.output_text.delta', delta: '{}' }) + event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })), 100)).rejects.toThrow('利用上限');
    await expect(readResponsesStream(stream(event({ type: 'response.incomplete' })), 100)).rejects.toThrow('完了しません');
  });
  it('bounds output bytes and rejects schema mismatches', async () => {
    await expect(readResponsesStream(stream(event({ type: 'response.output_text.delta', delta: '日本語' })), 5)).rejects.toThrow('サイズ上限');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream(event({ type: 'response.output_text.delta', delta: '{}' }) + event({ type: 'response.completed' })));
    await expect(new ChatGptLlmProvider(async () => 'test', fetcher).createContext({ purpose: 'generation', systemInstruction: 'test' }).generate(request)).rejects.toMatchObject({ code: 'schema_mismatch' });
  });
  it('does not request inference after cancellation or expose HTTP bodies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret details', { status: 403 }));
    const context = new ChatGptLlmProvider(async () => 'test', fetcher).createContext({ purpose: 'generation', systemInstruction: 'test' });
    await expect(context.generate({ ...request, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'cancelled' }); expect(fetcher).not.toHaveBeenCalled();
    await expect(context.generate(request)).rejects.toThrow('許可されていません');
  });
});
