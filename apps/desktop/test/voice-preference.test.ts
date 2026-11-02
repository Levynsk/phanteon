import { describe, expect, test } from 'bun:test';
import { applyVoicePreference, NO_PREFERENCE } from '../src/lib/voice-preference';

describe('voice preference kept outside a call', () => {
  test('muting out of a call is remembered for the next join', () => {
    expect(applyVoicePreference(NO_PREFERENCE, { selfMute: true })).toEqual({ selfMute: true, selfDeaf: false, pending: true });
  });

  test('deafening silences the mic too', () => {
    expect(applyVoicePreference(NO_PREFERENCE, { selfDeaf: true })).toEqual({ selfMute: true, selfDeaf: true, pending: true });
  });

  test('un-deafening keeps the mic muted until the user unmutes it', () => {
    const deafened = applyVoicePreference(NO_PREFERENCE, { selfDeaf: true });
    expect(applyVoicePreference(deafened, { selfDeaf: false })).toEqual({ selfMute: true, selfDeaf: false, pending: true });
  });

  test('actions take one step at a time, so toggles do not flip back and forth', () => {
    const deafened = applyVoicePreference(NO_PREFERENCE, { selfDeaf: true });
    const undeafened = applyVoicePreference(deafened, { selfDeaf: false, selfMute: true });
    const unmuted = applyVoicePreference(undeafened, { selfMute: false });
    expect(unmuted).toEqual({ selfMute: false, selfDeaf: false, pending: true });
  });

  test('a choice made while out of a call is pending until a join applies it', () => {
    expect(NO_PREFERENCE.pending).toBe(false);
  });
});
