import { Hono } from 'hono';
import type { AppVariables } from '../http/context';
import { revokeInvite } from '../services/invites';

/** Invite management that does not hang off a guild id in the URL. */
export const inviteRoutes = new Hono<{ Variables: AppVariables }>();

inviteRoutes.delete('/:code', (c) => {
  revokeInvite(c.get('currentUser').id, c.req.param('code'));
  return c.body(null, 204);
});
