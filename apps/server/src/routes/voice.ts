import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../http/context';
import { jsonBody } from '../http/validation';
import {
  joinVoice,
  leaveVoice,
  listGuildVoiceStates,
  listVoiceStatesForUser,
  moderateVoice,
  updateSelfVoice,
} from '../services/voice';
import { iceConfig } from '../services/ice';

const selfSchema = z.object({
  selfMute: z.boolean().optional(),
  selfDeaf: z.boolean().optional(),
});

const moderateSchema = z.object({
  action: z.enum(['serverMute', 'serverDeaf', 'disconnect']),
});

export const voiceRoutes = new Hono<{ Variables: AppVariables }>();

voiceRoutes.get('/', (c) => c.json({ states: listVoiceStatesForUser(c.get('currentUser').id) }));

/** ICE servers for the call mesh; the TURN relay only shows up when configured. */
voiceRoutes.get('/ice', (c) => c.json(iceConfig()));

voiceRoutes.get('/guilds/:guildId', (c) => {
  const states = listGuildVoiceStates(c.req.param('guildId'), c.get('currentUser').id);
  return c.json({ states });
});

voiceRoutes.post('/channels/:channelId/join', (c) => {
  const state = joinVoice(c.get('currentUser'), c.req.param('channelId'));
  return c.json({ state });
});

voiceRoutes.post('/guilds/:guildId/leave', (c) => {
  leaveVoice(c.get('currentUser'), c.req.param('guildId'));
  return c.body(null, 204);
});

voiceRoutes.patch('/@me', jsonBody(selfSchema), (c) => {
  const state = updateSelfVoice(c.get('currentUser'), c.req.valid('json'));
  return c.json({ state });
});

voiceRoutes.patch('/guilds/:guildId/members/:userId', jsonBody(moderateSchema), (c) => {
  moderateVoice(c.get('currentUser'), c.req.param('guildId'), c.req.param('userId'), c.req.valid('json').action);
  return c.body(null, 204);
});
