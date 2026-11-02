import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_MESSAGE_ATTACHMENTS } from '@phanteon/shared';
import { toPublicUser } from '../db/mappers';
import type { AppVariables } from '../http/context';
import { jsonBody, queryParams } from '../http/validation';
import { notFound } from '../http/errors';
import { db, schema } from '../db/client';
import { messageAudience } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { deleteChannel, getGuildChannel, updateChannel } from '../services/guilds';
import { channelOverridesFor } from '../services/roles';
import { assertChannelAccess, deleteMessage, editMessage, listMessages, searchMessages, sendMessage } from '../services/messages';
import { createCategory, deleteCategory, syncCategoryPermissions, updateCategory, updateChannelAccess, categoryDetails } from '../services/channels';

const sendSchema = z.object({
  content: z.string().max(4000).default(''),
  attachmentIds: z.array(z.string()).max(MAX_MESSAGE_ATTACHMENTS).default([]),
  replyToId: z.string().nullish(),
});

const editSchema = z.object({ content: z.string().max(4000) });

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  topic: z.string().max(200).nullable().optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
  overrides: z
    .array(z.object({ roleId: z.string().min(1), allow: z.number().int().nonnegative(), deny: z.number().int().nonnegative() }))
    .max(60)
    .optional(),
});

const listQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const channelRoutes = new Hono<{ Variables: AppVariables }>();

channelRoutes.get('/:channelId', (c) => {
  const channel = getGuildChannel(c.req.param('channelId'), c.get('currentUser').id);
  const overrides = channelOverridesFor(channel.id);
  return c.json({ channel, overrides });
});

channelRoutes.patch('/:channelId', jsonBody(updateSchema), (c) => {
  const channel = updateChannel(c.get('currentUser').id, c.req.param('channelId'), c.req.valid('json'));
  return c.json({ channel });
});

channelRoutes.delete('/:channelId', (c) => {
  deleteChannel(c.get('currentUser').id, c.req.param('channelId'));
  return c.body(null, 204);
});

channelRoutes.get('/:channelId/messages', queryParams(listQuery), (c) => {
  const user = c.get('currentUser');
  const { before, limit } = c.req.valid('query');
  const page = listMessages(c.req.param('channelId'), user.id, c.get('origin'), { before, limit });
  return c.json(page);
});

channelRoutes.get('/:channelId/messages/search', queryParams(searchQuery), (c) => {
  const user = c.get('currentUser');
  const { q, limit } = c.req.valid('query');
  const messages = searchMessages(c.req.param('channelId'), user.id, c.get('origin'), q, limit);
  return c.json({ messages });
});

channelRoutes.post('/:channelId/messages', jsonBody(sendSchema), (c) => {
  const user = c.get('currentUser');
  const body = c.req.valid('json');
  const message = sendMessage(
    user,
    c.req.param('channelId'),
    { content: body.content, attachmentIds: body.attachmentIds, replyToId: body.replyToId ?? null },
    c.get('origin'),
  );
  return c.json({ message }, 201);
});

channelRoutes.post('/:channelId/typing', (c) => {
  const user = c.get('currentUser');
  const channelId = c.req.param('channelId');
  assertChannelAccess(channelId, user.id);
  hub.emitTyping(channelId, toPublicUser(user), messageAudience(channelId));
  return c.body(null, 204);
});

channelRoutes.patch('/messages/:messageId', jsonBody(editSchema), (c) => {
  const message = editMessage(
    c.get('currentUser'),
    c.req.param('messageId'),
    c.req.valid('json').content,
    c.get('origin'),
  );
  return c.json({ message });
});

channelRoutes.delete('/messages/:messageId', (c) => {
  const result = deleteMessage(c.get('currentUser'), c.req.param('messageId'));
  return c.json(result);
});

export const orderSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), categoryId: z.string().min(1).nullable() })).max(200),
});

const accessSchema = z.object({
  visibility: z.enum(['public', 'private']).optional(),
  roleIds: z.array(z.string().min(1)).max(60).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).optional(),
  topic: z.string().max(200).nullable().optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
});

/** Visibility (public/private), the roles allowed in, rename and category moves. */
channelRoutes.put('/:channelId/access', jsonBody(accessSchema), (c) => {
  const channelId = c.req.param('channelId');
  const channel = updateChannelAccess(
    guildIdOfChannel(channelId),
    c.get('currentUser').id,
    channelId,
    c.req.valid('json'),
  );
  return c.json({ channel });
});

channelRoutes.post('/:channelId/sync-permissions', (c) => {
  const channelId = c.req.param('channelId');
  const channels = syncCategoryPermissions(guildIdOfChannel(channelId), c.get('currentUser').id, channelId);
  return c.json({ channels });
});

/** The guild lives on the channel row, so these routes do not need a guildId in the path. */
function guildIdOfChannel(channelId: string): string {
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!row || row.kind !== 'guild' || !row.guildId) throw notFound('Canal não encontrado.');
  return row.guildId;
}

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da categoria.').max(100),
  visibility: z.enum(['public', 'private']).optional(),
  roleIds: z.array(z.string().min(1)).max(60).optional(),
});

/** Mounted at `/api/guilds/:guildId/categories`. */
export const categoryRoutes = new Hono<{ Variables: AppVariables }>();

categoryRoutes.get('/', (c) => c.json(categoryDetails(c.req.param('guildId')!, c.get('currentUser').id)));

categoryRoutes.post('/', jsonBody(categorySchema), (c) => {
  const channel = createCategory(c.req.param('guildId')!, c.get('currentUser').id, c.req.valid('json'));
  return c.json({ channel }, 201);
});

categoryRoutes.patch('/:categoryId', jsonBody(categorySchema.partial()), (c) => {
  const existing = categoryDetails(c.req.param('guildId')!, c.get('currentUser').id).categories.find((entry) => entry.id === c.req.param('categoryId'));
  if (!existing) throw notFound('Categoria não encontrada.');
  const input = c.req.valid('json');
  const channel = updateCategory(c.req.param('guildId')!, c.get('currentUser').id, c.req.param('categoryId'), {
    ...input,
    name: input.name ?? existing.name,
  });
  return c.json({ channel });
});

categoryRoutes.delete('/:categoryId', (c) => {
  deleteCategory(c.req.param('guildId')!, c.get('currentUser').id, c.req.param('categoryId'));
  return c.body(null, 204);
});

categoryRoutes.post('/:categoryId/sync-permissions', (c) => {
  const channels = syncCategoryPermissions(c.req.param('guildId')!, c.get('currentUser').id, c.req.param('categoryId'));
  return c.json({ channels });
});
