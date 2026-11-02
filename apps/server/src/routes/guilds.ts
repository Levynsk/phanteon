import { Hono } from 'hono';
import { z } from 'zod';
import {
  MAX_GUILD_DESCRIPTION_LENGTH,
  MAX_GUILD_IMAGE_BYTES,
  MAX_GUILD_NAME_LENGTH,
} from '@phanteon/shared';
import type { AppVariables } from '../http/context';
import { AppError, badRequest } from '../http/errors';
import { jsonBody } from '../http/validation';
import { absoluteAssetUrl } from '../db/mappers';
import {
  changeMemberRole,
  createGuild,
  deleteGuild,
  getGuildDetails,
  joinGuildByInvite,
  leaveGuild,
  listGuildsForUser,
  removeMember,
  updateGuild,
  createChannel,
} from '../services/guilds';
import { actorContext, requirePermission } from '../services/roles';
import { banMember, listBans, unbanMember } from '../services/bans';
import { createInvite, listInvites } from '../services/invites';
import { AUDIT_ACTION_LABELS, listAuditLogs } from '../services/audit';
import { saveGuildImage } from '../services/uploads';
import { Permission } from '@phanteon/shared';
import { memberRoleRoutes, roleRoutes } from './roles';
import { categoryRoutes, orderSchema } from './channels';
import { reorderChannels } from '../services/channels';

const createGuildSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do servidor.').max(MAX_GUILD_NAME_LENGTH),
});

const updateGuildSchema = z.object({
  name: z.string().trim().min(1).max(MAX_GUILD_NAME_LENGTH).optional(),
  description: z.string().max(MAX_GUILD_DESCRIPTION_LENGTH).nullable().optional(),
  iconUrl: z.string().max(500).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
  iconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const roleSchema = z.object({ role: z.enum(['admin', 'member']) });

const channelSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do canal.'),
  type: z.enum(['text', 'voice']).optional(),
  topic: z.string().max(200).nullable().optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
  categoryId: z.string().min(1).nullable().optional(),
});

const inviteSchema = z.object({ code: z.string().trim().min(1, 'Informe o código do convite.') });

const inviteCreateSchema = z.object({
  /** 0 (or omitted) means unlimited. */
  maxUses: z.number().int().min(0).max(100).optional(),
  /** Milliseconds until expiry; omitted or null means it never expires. */
  durationMs: z.number().int().positive().nullable().optional(),
});

const banSchema = z.object({
  reason: z.string().max(300).nullable().optional(),
  /** Milliseconds; omitted or null for a permanent ban. */
  durationMs: z.number().int().positive().nullable().optional(),
});

export const guildRoutes = new Hono<{ Variables: AppVariables }>();

guildRoutes.get('/', (c) => c.json({ guilds: listGuildsForUser(c.get('currentUser').id, c.get('origin')) }));

guildRoutes.post('/', jsonBody(createGuildSchema), (c) => {
  const guild = createGuild(c.get('currentUser'), c.req.valid('json'), c.get('origin'));
  return c.json({ guild }, 201);
});

guildRoutes.post('/join', jsonBody(inviteSchema), (c) => {
  const guild = joinGuildByInvite(c.get('currentUser'), c.req.valid('json').code, c.get('origin'));
  return c.json({ guild });
});

guildRoutes.get('/:guildId', (c) => {
  const guildId = c.req.param('guildId');
  // throws 403 for outsiders, so private guild metadata is never leaked
  return c.json({ guild: getGuildDetails(guildId, c.get('currentUser').id, c.get('origin')) });
});

guildRoutes.patch('/:guildId', jsonBody(updateGuildSchema), (c) => {
  const guild = updateGuild(c.get('currentUser').id, c.req.param('guildId'), c.req.valid('json'), c.get('origin'));
  return c.json({ guild });
});

guildRoutes.delete('/:guildId', (c) => {
  deleteGuild(c.get('currentUser').id, c.req.param('guildId'));
  return c.body(null, 204);
});

guildRoutes.post('/:guildId/leave', (c) => {
  leaveGuild(c.get('currentUser').id, c.req.param('guildId'));
  return c.body(null, 204);
});

/**
 * Uploads an icon or banner (`kind=icon|banner`) and stores the resulting URL
 * on the guild in one step, so the UI never ends up with half-applied images.
 */
guildRoutes.post('/:guildId/images/:kind', async (c) => {
  const guildId = c.req.param('guildId');
  const kind = c.req.param('kind');
  if (kind !== 'icon' && kind !== 'banner') throw badRequest('Tipo de imagem inválido.');

  const actor = actorContext(guildId, c.get('currentUser').id);
  requirePermission(actor, Permission.ManageGuild, 'Você não pode alterar as imagens do servidor.');

  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) throw badRequest('Envie um arquivo no campo "file".');
  if (file.size > MAX_GUILD_IMAGE_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'A imagem deve ter no máximo 4 MB.');
  }

  const url = await saveGuildImage(file, kind);
  const guild = updateGuild(
    c.get('currentUser').id,
    guildId,
    kind === 'icon' ? { iconUrl: url } : { bannerUrl: url },
    c.get('origin'),
  );
  return c.json({ guild, url: absoluteAssetUrl(url, c.get('origin')) });
});

guildRoutes.post('/:guildId/channels', jsonBody(channelSchema), (c) => {
  const channel = createChannel(c.req.param('guildId'), c.get('currentUser').id, c.req.valid('json'));
  return c.json({ channel }, 201);
});

guildRoutes.put('/:guildId/channels/order', jsonBody(orderSchema), (c) => {
  const channels = reorderChannels(c.req.param('guildId'), c.get('currentUser').id, c.req.valid('json').items);
  return c.json({ channels });
});

guildRoutes.post('/:guildId/invites', jsonBody(inviteCreateSchema), (c) => {
  const invite = createInvite(c.get('currentUser').id, c.req.param('guildId'), c.req.valid('json'));
  return c.json({ invite }, 201);
});

guildRoutes.get('/:guildId/invites', (c) => {
  return c.json({ invites: listInvites(c.req.param('guildId'), c.get('currentUser').id) });
});

/** Legacy coarse-role endpoint: delegates to the system roles. */
guildRoutes.patch('/:guildId/members/:userId', jsonBody(roleSchema), (c) => {
  changeMemberRole(
    c.get('currentUser').id,
    c.req.param('guildId'),
    c.req.param('userId'),
    c.req.valid('json').role,
  );
  return c.json({ ok: true });
});

guildRoutes.delete('/:guildId/members/:userId', (c) => {
  removeMember(c.get('currentUser').id, c.req.param('guildId'), c.req.param('userId'));
  return c.body(null, 204);
});

guildRoutes.route('/:guildId/roles', roleRoutes);
guildRoutes.route('/:guildId/categories', categoryRoutes);
guildRoutes.route('/:guildId/member-roles', memberRoleRoutes);

// ---- bans ---------------------------------------------------------------

guildRoutes.get('/:guildId/bans', (c) => {
  const bans = listBans(c.req.param('guildId'), c.get('currentUser').id);
  return c.json({ bans });
});

guildRoutes.put('/:guildId/bans/:userId', jsonBody(banSchema), (c) => {
  const ban = banMember(c.get('currentUser').id, c.req.param('guildId'), c.req.param('userId'), c.req.valid('json'));
  return c.json({ ban });
});

guildRoutes.delete('/:guildId/bans/:userId', (c) => {
  unbanMember(c.get('currentUser').id, c.req.param('guildId'), c.req.param('userId'));
  return c.body(null, 204);
});

// ---- audit log ----------------------------------------------------------

guildRoutes.get('/:guildId/audit-logs', (c) => {
  const page = listAuditLogs(c.req.param('guildId'), c.get('currentUser').id, {
    action: c.req.query('action') || undefined,
    targetId: c.req.query('targetId') || undefined,
    before: c.req.query('before') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  });
  return c.json(page);
});

guildRoutes.get('/:guildId/audit-actions', (c) => {
  const actor = actorContext(c.req.param('guildId'), c.get('currentUser').id);
  requirePermission(actor, Permission.ViewAuditLog, 'Você não pode ver os logs de auditoria.');
  return c.json({ actions: AUDIT_ACTION_LABELS });
});
