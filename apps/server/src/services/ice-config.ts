import type { IceConfig } from '@phanteon/shared';

/**
 * Pure mapping from deployment settings to the ICE list, kept apart from the
 * environment read so it can be tested without restarting the process.
 * A relay is only offered when url, username and credential are all present:
 * half-configured TURN makes every peer connection fail.
 */
export function buildIceConfig(env: Record<string, string | undefined>): IceConfig {
  const stunUrls = (env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  // the list is comma separated and each entry may carry `?transport=...`
  const turnUrls = (env.TURN_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const username = env.TURN_USERNAME?.trim() ?? '';
  const credential = env.TURN_CREDENTIAL?.trim() ?? '';

  const servers: IceConfig['iceServers'] = [];
  if (stunUrls.length > 0) servers.push({ urls: stunUrls });
  const relayConfigured = turnUrls.length > 0 && Boolean(username) && Boolean(credential);
  if (relayConfigured) servers.push({ urls: turnUrls, username, credential });

  return { iceServers: servers, relayConfigured };
}
