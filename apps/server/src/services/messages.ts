import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Message, MessageReference, Reaction } from '@phanteon/shared';
import { MAX_MESSAGE_ATTACHMENTS, MAX_MESSAGE_LENGTH, PAGE_SIZE, Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { toMessage, toPublicUser } from '../db/mappers';
import type { AttachmentRow, MessageRow, UserRow } from '../db/schema';
import { badRequest, forbidden, notFound } from '../http/errors';
import { channelAudience, messageAudience } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { actorContext, canActOn, resolveChannelPermissions } from './roles';
import { assertDmAllowed } from './relationships';
import { deleteUploadedFiles } from './uploads';

function getChannelRow(channelId: string) {
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel) throw notFound('Canal não encontrado.');
  return channel;
}

/** Membership + permission check for anything that touches a channel. */
function assertChannelPermission(channelId: string, userId: string, flag: number): void {
  const channel = assertChannelAccess(channelId, userId);
  if (channel.kind === 'guild' && channel.guildId) {
    const actor = actorContext(channel.guildId, userId);
    if ((actor.permissions & flag) !== flag) {
      throw forbidden(
        flag === Permission.SendMessages
          ? 'Você não tem permissão para enviar mensagens neste servidor.'
          : 'Você não tem permissão para isso neste servidor.',
      );
    }
  }
}

export function assertChannelAccess(channelId: string, userId: string) {
  const channel = getChannelRow(channelId);
  if (!channelAudience(channelId).includes(userId)) {
    throw forbidden('Você não tem acesso a este canal.');
  }
  // a channel-level override can hide the channel even from guild members
  if (channel.kind === 'guild' && channel.guildId) {
    const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, channel.guildId)).get();
    if (guild && (resolveChannelPermissions(guild, channel.id, userId) & Permission.ViewChannel) === 0) {
      throw forbidden('Você não tem acesso a este canal.');
    }
  }
  return channel;
}

function groupReactions(messageIds: string[], viewerId: string): Map<string, Reaction[]> {
  const grouped = new Map<string, Reaction[]>();
  if (messageIds.length === 0) return grouped;

  const rows = db
    .select()
    .from(schema.reactions)
    .where(inArray(schema.reactions.messageId, messageIds))
    .orderBy(asc(schema.reactions.createdAt))
    .all();

  for (const row of rows) {
    const list = grouped.get(row.messageId) ?? [];
    const existing = list.find((reaction) => reaction.emoji === row.emoji);
    if (existing) {
      existing.count += 1;
      existing.me ||= row.userId === viewerId;
    } else {
      list.push({ emoji: row.emoji, count: 1, me: row.userId === viewerId });
    }
    grouped.set(row.messageId, list);
  }
  return grouped;
}

/** Compact snapshots of quoted messages, reusing authors already loaded for the page. */
function hydrateReferences(ids: string[], authors: Map<string, UserRow>): Map<string, MessageReference> {
  const references = new Map<string, MessageReference>();
  if (ids.length === 0) return references;

  const quoted = db.select().from(schema.messages).where(inArray(schema.messages.id, ids)).all();
  const missingAuthors = [...new Set(quoted.map((row) => row.authorId))].filter((id) => !authors.has(id));
  if (missingAuthors.length > 0) {
    for (const author of db.select().from(schema.users).where(inArray(schema.users.id, missingAuthors)).all()) {
      authors.set(author.id, author);
    }
  }

  const withAttachments = new Set(
    db
      .select({ messageId: schema.messageAttachments.messageId })
      .from(schema.messageAttachments)
      .where(inArray(schema.messageAttachments.messageId, ids))
      .all()
      .map((row) => row.messageId),
  );

  for (const row of quoted) {
    const author = authors.get(row.authorId);
    if (!author) continue;
    references.set(row.id, {
      id: row.id,
      author: toPublicUser(author),
      content: row.content,
      hasAttachments: withAttachments.has(row.id),
    });
  }
  return references;
}

export function hydrateMessages(rows: MessageRow[], viewerId: string, origin: string): Message[] {
  if (rows.length === 0) return [];

  const authors = new Map<string, UserRow>();
  for (const author of db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(rows.map((row) => row.authorId))]))
    .all()) {
    authors.set(author.id, author);
  }

  const messageIds = [...new Set(rows.map((row) => row.id))];
  const attachmentsByMessage = new Map<string, AttachmentRow[]>();
  const links = db
    .select()
    .from(schema.messageAttachments)
    .where(inArray(schema.messageAttachments.messageId, messageIds))
    .orderBy(asc(schema.messageAttachments.position))
    .all();
  if (links.length > 0) {
    const byId = new Map<string, AttachmentRow>();
    for (const attachment of db
      .select()
      .from(schema.attachments)
      .where(inArray(schema.attachments.id, [...new Set(links.map((link) => link.attachmentId))]))
      .all()) {
      byId.set(attachment.id, attachment);
    }
    for (const link of links) {
      const attachment = byId.get(link.attachmentId);
      if (!attachment) continue;
      const list = attachmentsByMessage.get(link.messageId) ?? [];
      list.push(attachment);
      attachmentsByMessage.set(link.messageId, list);
    }
  }

  const replies = hydrateReferences(
    [...new Set(rows.map((row) => row.replyToId).filter((id): id is string => !!id))],
    authors,
  );

  const reactions = groupReactions(messageIds, viewerId);

  return rows.map((row) =>
    toMessage(
      row,
      authors.get(row.authorId)!,
      attachmentsByMessage.get(row.id) ?? [],
      (row.replyToId && replies.get(row.replyToId)) || null,
      reactions.get(row.id) ?? [],
      origin,
    ),
  );
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

export function listMessages(
  channelId: string,
  viewerId: string,
  origin: string,
  options: { before?: string; limit?: number } = {},
): MessagePage {
  assertChannelAccess(channelId, viewerId);
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 100);

  const conditions = [eq(schema.messages.channelId, channelId)];
  if (options.before) {
    const anchor = db.select().from(schema.messages).where(eq(schema.messages.id, options.before)).get();
    if (!anchor) throw notFound('Mensagem de referência não encontrada.');
    conditions.push(lt(schema.messages.createdAt, anchor.createdAt));
  }

  const rows = db
    .select()
    .from(schema.messages)
    .where(and(...conditions))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return { messages: hydrateMessages(page, viewerId, origin), hasMore };
}

export function searchMessages(
  channelId: string,
  viewerId: string,
  origin: string,
  query: string,
  limit = 30,
): Message[] {
  assertChannelAccess(channelId, viewerId);
  const term = query.trim();
  if (!term) return [];
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const rows = db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.channelId, channelId), sql`instr(lower(${schema.messages.content}), lower(${term})) > 0`))
    .orderBy(desc(schema.messages.createdAt))
    .limit(boundedLimit)
    .all()
    .reverse();
  return hydrateMessages(rows, viewerId, origin);
}

function getMessageRow(messageId: string): MessageRow {
  const row = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!row) throw notFound('Mensagem não encontrada.');
  return row;
}

function findAttachmentFor(authorId: string, attachmentId: string): AttachmentRow {
  const attachment = db
    .select()
    .from(schema.attachments)
    .where(and(eq(schema.attachments.id, attachmentId), eq(schema.attachments.uploaderId, authorId)))
    .get();
  if (!attachment) throw notFound('Anexo não encontrado.');
  return attachment;
}

export interface SendMessageInput {
  content: string;
  attachmentIds?: string[];
  replyToId?: string | null;
}

/** A reply must point at a message this user is allowed to read, in the same channel. */
function resolveReply(replyToId: string | null | undefined, channelId: string, userId: string): MessageReference | null {
  if (!replyToId) return null;
  const target = db.select().from(schema.messages).where(eq(schema.messages.id, replyToId)).get();
  if (!target) throw notFound('A mensagem respondida não existe mais.');
  if (target.channelId !== channelId) throw badRequest('Não é possível responder a uma mensagem de outro canal.');
  assertChannelAccess(target.channelId, userId);
  const channel = getChannelRow(target.channelId);
  // a block also cuts quoting the other person inside a shared DM
  if (channel.kind === 'dm' && target.authorId !== userId) assertDmAllowed(userId, target.authorId);
  const author = db.select().from(schema.users).where(eq(schema.users.id, target.authorId)).get();
  const hasAttachments =
    !!db.select().from(schema.messageAttachments).where(eq(schema.messageAttachments.messageId, target.id)).get();
  return {
    id: target.id,
    author: toPublicUser(author!),
    content: target.content,
    hasAttachments,
  };
}

export function sendMessage(author: UserRow, channelId: string, input: SendMessageInput, origin: string): Message {
  assertChannelPermission(channelId, author.id, Permission.SendMessages);
  // a block shuts the DM down for both sides, like Discord
  const channel = getChannelRow(channelId);
  if (channel.kind === 'dm') {
    for (const recipientId of channelAudience(channelId)) {
      if (recipientId !== author.id) assertDmAllowed(author.id, recipientId);
    }
  }
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (attachmentIds.length > MAX_MESSAGE_ATTACHMENTS) {
    throw badRequest(`Anexe no máximo ${MAX_MESSAGE_ATTACHMENTS} arquivos por mensagem.`);
  }
  if (attachmentIds.length > 0) assertChannelPermission(channelId, author.id, Permission.AttachFiles);
  const content = input.content ?? '';
  if (!content.trim() && attachmentIds.length === 0) throw badRequest('A mensagem precisa de conteúdo ou anexo.');
  if (content.length > MAX_MESSAGE_LENGTH) {
    throw badRequest(`A mensagem pode ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`);
  }

  const attachments = attachmentIds.map((id) => findAttachmentFor(author.id, id));
  const replyTo = resolveReply(input.replyToId, channelId, author.id);

  const row: MessageRow = {
    id: newId(),
    channelId,
    authorId: author.id,
    content,
    attachmentId: null,
    replyToId: replyTo?.id ?? null,
    editedAt: null,
    createdAt: nowIso(),
  };
  db.transaction((tx) => {
    tx.insert(schema.messages).values(row).run();
    if (attachments.length > 0) {
      tx.insert(schema.messageAttachments)
        .values(attachments.map((attachment, position) => ({ messageId: row.id, attachmentId: attachment.id, position })))
        .run();
    }
  });

  const message = toMessage(row, author, attachments, replyTo, [], origin);
  hub.emitToUsers(messageAudience(channelId), { type: 'message:create', message });
  return message;
}

export function editMessage(user: UserRow, messageId: string, content: string, origin: string): Message {
  const row = getMessageRow(messageId);
  if (row.authorId !== user.id) throw forbidden('Você só pode editar suas próprias mensagens.');
  assertChannelPermission(row.channelId, user.id, Permission.ManageOwnMessages);
  if (!content.trim()) throw badRequest('A mensagem não pode ficar vazia.');
  if (content.length > MAX_MESSAGE_LENGTH) {
    throw badRequest(`A mensagem pode ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`);
  }

  const updated = db
    .update(schema.messages)
    .set({ content, editedAt: nowIso() })
    .where(eq(schema.messages.id, messageId))
    .returning()
    .get();

  const [message] = hydrateMessages([updated], user.id, origin);
  if (!message) throw notFound('Mensagem não encontrada.');
  hub.emitToUsers(messageAudience(row.channelId), { type: 'message:update', message });
  return message;
}

export function deleteMessage(user: UserRow, messageId: string): { channelId: string; messageId: string } {
  const row = getMessageRow(messageId);
  const channel = getChannelRow(row.channelId);
  const isAuthor = row.authorId === user.id;
  const isModerator = channel.guildId
    ? (actorContext(channel.guildId, user.id).permissions & Permission.ManageMessages) === Permission.ManageMessages
    : false;
  if (isAuthor) assertChannelPermission(row.channelId, user.id, Permission.ManageOwnMessages);
  else if (!isModerator) throw forbidden('Você não pode excluir esta mensagem.');
  // moderators cannot delete messages from members ranked above them
  if (!isAuthor && channel.guildId) {
    const actor = actorContext(channel.guildId, user.id);
    if (!canActOn(actor, row.authorId)) throw forbidden('Você não pode excluir mensagens de alguém acima de você.');
  }

  const attachmentIds = db
    .select({ id: schema.messageAttachments.attachmentId })
    .from(schema.messageAttachments)
    .where(eq(schema.messageAttachments.messageId, messageId))
    .all()
    .map((link) => link.id);
  if (row.attachmentId) attachmentIds.push(row.attachmentId);

  const urls = attachmentIds.map((id) => {
    const attachment = db.select({ url: schema.attachments.url }).from(schema.attachments).where(eq(schema.attachments.id, id)).get();
    return attachment?.url ?? null;
  });
  db.delete(schema.messages).where(eq(schema.messages.id, messageId)).run();
  for (const attachmentId of attachmentIds) {
    db.delete(schema.attachments).where(eq(schema.attachments.id, attachmentId)).run();
  }
  // the row is gone; the file must not outlive it on an unauthenticated /files URL
  void deleteUploadedFiles(urls);
  hub.emitToUsers(messageAudience(row.channelId), {
    type: 'message:delete',
    channelId: row.channelId,
    messageId,
  });
  return { channelId: row.channelId, messageId };
}

export function toggleReaction(
  user: UserRow,
  messageId: string,
  emoji: string,
): { channelId: string; messageId: string; reaction: Reaction } {
  const row = getMessageRow(messageId);
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 32) throw badRequest('Emoji inválido.');
  assertChannelPermission(row.channelId, user.id, Permission.AddReactions);

  const where = and(
    eq(schema.reactions.messageId, messageId),
    eq(schema.reactions.userId, user.id),
    eq(schema.reactions.emoji, trimmed),
  );
  const mine = db.select().from(schema.reactions).where(where).get();

  if (mine) {
    db.delete(schema.reactions).where(where).run();
  } else {
    db.insert(schema.reactions).values({ messageId, userId: user.id, emoji: trimmed, createdAt: nowIso() }).run();
  }

  const reaction =
    groupReactions([messageId], user.id)
      .get(messageId)
      ?.find((entry) => entry.emoji === trimmed) ?? { emoji: trimmed, count: 0, me: false };

  const payload = { channelId: row.channelId, messageId, reaction };
  hub.emitToUsers(messageAudience(row.channelId), { type: 'reaction:update', payload });
  return payload;
}
