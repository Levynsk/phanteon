import { Hono } from 'hono';
import type { AppVariables } from '../http/context';
import {
  acceptFriendRequest,
  blockUser,
  declineFriendRequest,
  getFriendsOverview,
  relationshipKind,
  removeFriend,
  sendFriendRequest,
  unblockUser,
} from '../services/relationships';

/** Mounted at `/api/friends`. */
export const friendRoutes = new Hono<{ Variables: AppVariables }>();

friendRoutes.get('/', (c) => c.json({ friends: getFriendsOverview(c.get('currentUser').id) }));

friendRoutes.get('/:userId', (c) => {
  const me = c.get('currentUser').id;
  return c.json({ relationship: relationshipKind(me, c.req.param('userId')) });
});

friendRoutes.post('/:userId', (c) => {
  const { created } = sendFriendRequest(c.get('currentUser').id, c.req.param('userId'));
  return c.json({ friends: getFriendsOverview(c.get('currentUser').id) }, created ? 201 : 200);
});

friendRoutes.post('/:userId/accept', (c) => {
  acceptFriendRequest(c.get('currentUser').id, c.req.param('userId'));
  return c.json({ friends: getFriendsOverview(c.get('currentUser').id) });
});

/** Declines an incoming request or cancels an outgoing one. */
friendRoutes.delete('/:userId/request', (c) => {
  declineFriendRequest(c.get('currentUser').id, c.req.param('userId'));
  return c.json({ friends: getFriendsOverview(c.get('currentUser').id) });
});

friendRoutes.delete('/:userId', (c) => {
  removeFriend(c.get('currentUser').id, c.req.param('userId'));
  return c.json({ friends: getFriendsOverview(c.get('currentUser').id) });
});

friendRoutes.put('/:userId/block', (c) => {
  blockUser(c.get('currentUser').id, c.req.param('userId'));
  return c.json({ friends: getFriendsOverview(c.get('currentUser').id) });
});

friendRoutes.delete('/:userId/block', (c) => {
  unblockUser(c.get('currentUser').id, c.req.param('userId'));
  return c.json({ friends: getFriendsOverview(c.get('currentUser').id) });
});
