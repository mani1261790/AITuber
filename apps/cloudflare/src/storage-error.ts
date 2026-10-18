/** Recognize platform limits without exposing storage internals or credentials. */
export function storageQuotaError(error: unknown): {error: string; message: string} | null {
  const message = error instanceof Error ? error.message : '';
  if (!/Exceeded allowed (?:rows read|rows written|storage).*Durable Objects free tier/i.test(message)) return null;
  return {error:'storage_quota_exceeded',message:'Cloudflareの無料利用枠が上限に達しました。自動更新を停止しています。日本時間の午前9時に枠がリセットされた後、「更新」を押してください。'};
}
