import { describe, expect, test } from 'bun:test';
import { categoryUpdatePayload } from '../src/features/settings/ChannelsTab';

const draft = { visibility: 'private' as const, roleIds: ['role-vip'] };

describe('category save payload', () => {
  test('an unloaded access draft never overwrites stored role access', () => {
    // the editor starts on an empty draft; saving before the load returned used to clear access
    const payload = categoryUpdatePayload('novo nome', 'antigo', { visibility: 'public', roleIds: [] }, false);
    expect(payload).toEqual({ name: 'novo nome' });
    expect('roleIds' in payload).toBe(false);
    expect('visibility' in payload).toBe(false);
  });

  test('once loaded, the draft is sent so the admin can change it', () => {
    expect(categoryUpdatePayload('novo nome', 'antigo', draft, true)).toEqual({
      name: 'novo nome',
      visibility: 'private',
      roleIds: ['role-vip'],
    });
  });

  test('an empty name keeps the current one', () => {
    expect(categoryUpdatePayload('   ', 'antigo', draft, true).name).toBe('antigo');
  });
});
