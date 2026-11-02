/**
 * Mic and sound choices made outside a call. The server only stores voice
 * state for people seated in a channel, so a toggle pressed while not in a
 * call is kept here and applied the moment the user joins one.
 */
export interface VoicePreference {
  selfMute: boolean;
  selfDeaf: boolean;
  /** Cleared once a call applies it, so later joins keep whatever the user chose there. */
  pending: boolean;
}

export const NO_PREFERENCE: VoicePreference = { selfMute: false, selfDeaf: false, pending: false };

/**
 * Mic and sound cannot disagree with deafen: deafening silences the mic too.
 * Un-deafening leaves the mic muted, so the user is never heard by accident.
 */
export function applyVoicePreference(current: VoicePreference, input: { selfMute?: boolean; selfDeaf?: boolean }): VoicePreference {
  const selfDeaf = input.selfDeaf ?? current.selfDeaf;
  const selfMute = selfDeaf ? true : input.selfMute ?? current.selfMute;
  return { selfDeaf, selfMute, pending: true };
}
