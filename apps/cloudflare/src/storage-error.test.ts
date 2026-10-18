import {expect, it} from 'vitest';
import {storageQuotaError} from './storage-error';
it('identifies exhausted storage quotas without disclosing internal errors', () => {
 expect(storageQuotaError(new Error('Exceeded allowed rows read in Durable Objects free tier.'))).toMatchObject({error:'storage_quota_exceeded'});
 expect(storageQuotaError(new Error('Exceeded allowed rows written in Durable Objects free tier.'))).toMatchObject({error:'storage_quota_exceeded'});
 expect(storageQuotaError(new Error('private detail'))).toBeNull();
 expect(storageQuotaError(new Error('AITUBER_STORAGE_SAFETY_LIMIT'))).toMatchObject({error:'storage_quota_exceeded'});
});
