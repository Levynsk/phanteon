import { Hono } from 'hono';
import { z } from 'zod';
import { USER_STATUSES } from '@phanteon/shared';
import { getUserRow, searchUsers, updateProfile } from '../services/users';
import { toPublicUser, toSelfUser } from '../db/mappers';
import type { AppVariables } from '../http/context';
import { jsonBody } from '../http/validation';

export const userRoutes = new Hono<{ Variables: AppVariables }>();

userRoutes.get('/', (c) => {
  const me = c.get('currentUser');
  const query = c.req.query('q') ?? '';
  const users = searchUsers(query, me.id, 20, c.get('origin'));
  return c.json({ users });
});

userRoutes.get('/:id', (c) => {
  const user = getUserRow(c.req.param('id'));
  const publicUser =
    user.id === c.get('currentUser').id ? toSelfUser(user, c.get('origin')) : toPublicUser(user, c.get('origin'));
  return c.json({ user: publicUser });
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  status: z.enum(USER_STATUSES).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor hexadecimal.')
    .optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
  bio: z.string().max(190).nullable().optional(),
});

userRoutes.patch('/@me', jsonBody(profileSchema), (c) => {
  const me = c.get('currentUser');
  return c.json({ user: updateProfile(me.id, c.req.valid('json'), c.get('origin')) });
});
