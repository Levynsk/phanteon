import type { IceConfig } from '@phanteon/shared';
import { config } from '../config/env';
import { buildIceConfig } from './ice-config';

/**
 * ICE servers for WebRTC. STUN is always public; the TURN relay is only added
 * when the deployment provides credentials, so the app works on a LAN without
 * one and falls back to the relay behind NAT.
 */
export function iceConfig(): IceConfig {
  return buildIceConfig({
    STUN_URLS: config.stunUrls.join(','),
    TURN_URLS: config.turn.urls.join(','),
    TURN_USERNAME: config.turn.username,
    TURN_CREDENTIAL: config.turn.credential,
  });
}
