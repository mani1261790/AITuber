import {StorageSafetyLimit,STORAGE_SAFETY_MESSAGE} from './platform/storage-budget';
/** Recognize platform limits without exposing storage internals or credentials. */
export function storageQuotaError(error: unknown): {error: string; message: string} | null {
  if(error instanceof StorageSafetyLimit || error instanceof Error && error.message.includes('AITUBER_STORAGE_SAFETY_LIMIT'))return {error:'storage_safety_stop',message:STORAGE_SAFETY_MESSAGE};
  const message = error instanceof Error ? error.message : '';
  if (!/Exceeded allowed (?:rows read|rows written|storage).*Durable Objects free tier/i.test(message)) return null;
  return {error:'storage_quota_exceeded',message:'Cloudflareの無料利用枠が上限に達しました。自動更新を停止しています。日本時間の午前9時に枠がリセットされた後、「更新」を押してください。'};
}
