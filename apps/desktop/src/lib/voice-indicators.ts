import { Headphones, HeadphoneOff, Mic, MicOff } from 'lucide-react';

/**
 * One source of truth for how the mic/sound states look everywhere (dock, call
 * bar, participant tiles, sidebar). Active = the control is doing its job, so a
 * muted mic or a deafened user shows the "off" icon; anything that silences the
 * person is drawn in red, the brand colour marks the user's own toggles.
 */

/** Icon for a mic that is currently off (self mute, server mute or no capture). */
export const MIC_OFF = MicOff;
/** Icon for a mic that is transmitting. */
export const MIC_ON = Mic;
/** Icon for sound that is currently off (self or server deafen). */
export const SOUND_OFF = HeadphoneOff;
/** Icon for sound that is open. */
export const SOUND_ON = Headphones;

/** Colour of an "off" state in read-only lists (member lists, tiles). */
export const OFF_STATE = 'text-red';
/** Colour of an open state; muted by default so the row stays calm. */
export const ON_STATE = 'text-muted';
