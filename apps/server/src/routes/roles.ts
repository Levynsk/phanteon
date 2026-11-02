import { Hono } from 'hono';
import { z } from 'zod';
import { MAX_ROLE_NAME_LENGTH } from '@phanteon/shared';
import type { AppVariables } from '../http/context';
import { jsonBody } from '../http/validation';
import {
  createRole,
  deleteRole,
  listRolesWithCounts,
  reorderRoles,
  updateRole,
} from '../services/roles';
import { assignRoles, getMemberRoleIds, requireMembership } from '../services/guilds';

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor hexadecimal, ex.: #fbbf24.');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cargo.').max(MAX_ROLE_NAME_LENGTH),
  color: colorSchema.optional(),
  permissions: z.number().int().min(0).max(2 ** 31 - 1).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(MAX_ROLE_NAME_LENGTH).optional(),
  color: colorSchema.optional(),
  permissions: z.number().int().min(0).max(2 ** 31 - 1).optional(),
});

const reorderSchema = z.object({ roleIds: z.array(z.string().min(1)).max(80) });
const memberRolesSchema = z.object({ roleIds: z.array(z.string().min(1)).max(80) });

/** Mounted at `/guilds/:guildId/roles`. */
export const roleRoutes = new Hono<{ Variables: AppVariables }>();

roleRoutes.get('/', (c) => {
  const guildId = c.req.param('guildId')!;
  requireMembership(guildId, c.get('currentUser').id);
  return c.json({ roles: listRolesWithCounts(guildId) });
});

roleRoutes.post('/', jsonBody(createSchema), (c) => {
  const guildId = c.req.param('guildId')!;
  const role = createRole(guildId, c.get('currentUser').id, c.req.valid('json'));
  return c.json({ role }, 201);
});

roleRoutes.patch('/:roleId', jsonBody(updateSchema), (c) => {
  const role = updateRole(
    c.req.param('guildId')!,
    c.get('currentUser').id,
    c.req.param('roleId'),
    c.req.valid('json'),
  );
  return c.json({ role });
});

roleRoutes.delete('/:roleId', (c) => {
  deleteRole(c.req.param('guildId')!, c.get('currentUser').id, c.req.param('roleId'));
  return c.body(null, 204);
});

roleRoutes.put('/order', jsonBody(reorderSchema), (c) => {
  const roles = reorderRoles(c.req.param('guildId')!, c.get('currentUser').id, c.req.valid('json').roleIds);
  return c.json({ roles });
});

/** Mounted at `/guilds/:guildId/member-roles`. */
export const memberRoleRoutes = new Hono<{ Variables: AppVariables }>();

memberRoleRoutes.get('/:userId/roles', (c) => {
  const guildId = c.req.param('guildId')!;
  const userId = c.req.param('userId');
  requireMembership(guildId, c.get('currentUser').id);
  return c.json({ roleIds: getMemberRoleIds(guildId, userId) });
});

memberRoleRoutes.put('/:userId/roles', jsonBody(memberRolesSchema), (c) => {
  const guildId = c.req.param('guildId')!;
  const userId = c.req.param('userId');
  assignRoles(guildId, c.get('currentUser').id, userId, c.req.valid('json').roleIds);
  return c.json({ roleIds: getMemberRoleIds(guildId, userId) });
});
