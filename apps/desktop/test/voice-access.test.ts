import { describe, expect, test } from 'bun:test';
import { Permission } from '@phanteon/shared';
import { voiceAccessOverride } from '../src/components/modals/ChannelModals';

describe('voice Connect/Speak switches', () => {
  test('re-allowing Connect and Speak clears the old deny instead of sending nothing', () => {
    // the dialog used to send no override when everything was allowed, so the stored deny survived
    const clear = voiceAccessOverride(true, true);
    expect(clear.deny).toBe(0);
    expect(clear.deny).not.toBe(Permission.Connect | Permission.Speak);
  });

  test('denying only Speak keeps Connect and encodes it in deny', () => {
    const onlySpeakDenied = voiceAccessOverride(true, false);
    expect(onlySpeakDenied.deny).toBe(Permission.Speak);
    expect(onlySpeakDenied.allow).toBe(Permission.Connect);
  });

  test('denying both sets both bits', () => {
    expect(voiceAccessOverride(false, false).deny).toBe(Permission.Connect | Permission.Speak);
  });
});
