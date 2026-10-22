import { afterEach, describe, expect, it } from 'vitest';
import { DRAFT_MAX_AGE_MS, purgeExpiredDrafts, readDraft, removeUserDrafts, writeDraft } from './draft-storage';

const farmerA = { userId: 'user-a', farmId: 'farm-1', formId: 'item-create:FEED' };

afterEach(() => window.localStorage.clear());

describe('form drafts on this device', () => {
  it('survive a reload: what was written is read back with its time', () => {
    const savedAt = writeDraft(farmerA, { name: 'Makkajo‘xori', quantity: '500' }, null, 1_000);
    expect(savedAt).toBe(1_000);
    expect(readDraft(farmerA, 2_000)).toEqual({
      savedAt: 1_000,
      version: null,
      values: { name: 'Makkajo‘xori', quantity: '500' },
    });
  });

  it('are kept apart per user, farm and form', () => {
    writeDraft(farmerA, { name: 'A' });
    expect(readDraft({ ...farmerA, userId: 'user-b' })).toBeNull();
    expect(readDraft({ ...farmerA, farmId: 'farm-2' })).toBeNull();
    expect(readDraft({ ...farmerA, formId: 'item-create:MEDICINE' })).toBeNull();
  });

  it('never keep passwords or tokens', () => {
    writeDraft(farmerA, { name: 'A', password: 'secret123', accessToken: 'x', csrf: 'y' });
    expect(readDraft<Record<string, string>>(farmerA)?.values).toEqual({ name: 'A' });
    expect(JSON.stringify(window.localStorage)).not.toMatch(/secret123/);
  });

  it('expire after a week', () => {
    writeDraft(farmerA, { name: 'A' }, null, 0);
    expect(readDraft(farmerA, DRAFT_MAX_AGE_MS + 1)).toBeNull();
    writeDraft(farmerA, { name: 'A' }, null, 0);
    purgeExpiredDrafts(DRAFT_MAX_AGE_MS + 1);
    expect(window.localStorage.length).toBe(0);
  });

  it('are removed for the user who logs out, not for others', () => {
    writeDraft(farmerA, { name: 'A' });
    writeDraft({ ...farmerA, userId: 'user-b' }, { name: 'B' });
    removeUserDrafts('user-a');
    expect(readDraft(farmerA)).toBeNull();
    expect(readDraft({ ...farmerA, userId: 'user-b' })?.values).toEqual({ name: 'B' });
  });
});
