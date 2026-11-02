import { and, eq, or } from 'drizzle-orm';
import type { FriendsOverview, PublicUser, Relationship, RelationshipKind } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { nowIso } from '../db/ids';
import { toPublicUser } from '../db/mappers';
import type { RelationshipRow, UserRow } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { hub } from '../realtime/hub';

function getUser(userId: string): UserRow {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw notFound('Usuário não encontrado.');
  return user;
}

/** Matches the pair in either direction (blocked rows keep the blocker first). */
function pairCondition(a: string, b: string) {
  return or(
    and(eq(schema.relationships.requesterId, a), eq(schema.relationships.addresseeId, b)),
    and(eq(schema.relationships.requesterId, b), eq(schema.relationships.addresseeId, a)),
  );
}

function rowBetween(a: string, b: string): RelationshipRow | undefined {
  return db.select().from(schema.relationships).where(pairCondition(a, b)).get();
}

function rowsFor(userId: string): RelationshipRow[] {
  return db
    .select()
    .from(schema.relationships)
    .where(or(eq(schema.relationships.requesterId, userId), eq(schema.relationships.addresseeId, userId)))
    .all();
}

/** True when either side blocked the other. */
export function isBlockedBetween(a: string, b: string): boolean {
  return rowBetween(a, b)?.kind === 'blocked';
}

/**
 * True only when `actorId` did the blocking. The pair is blocked for both sides,
 * but the blocker keeps the right to undo it, so "the pair is blocked" must not
 * hide the blocker from their own screens.
 */
export function blocksBetween(actorId: string, targetId: string): boolean {
  const row = rowBetween(actorId, targetId);
  return row?.kind === 'blocked' && row.requesterId === actorId;
}

export function hasBlocked(blockerId: string, targetId: string): boolean {
  const row = rowBetween(blockerId, targetId);
  return row?.kind === 'blocked' && row.requesterId === blockerId;
}

/** Throws when a DM between the two users must not be allowed. */
export function assertDmAllowed(a: string, b: string): void {
  if (isBlockedBetween(a, b)) throw forbidden('Você não pode enviar mensagens para este usuário.');
}

function kindFor(row: RelationshipRow, viewerId: string): RelationshipKind {
  if (row.kind === 'blocked') return row.requesterId === viewerId ? 'blocked' : 'blockedBy';
  if (row.kind === 'pending') return row.requesterId === viewerId ? 'outgoing' : 'incoming';
  return 'friend';
}

function describe(row: RelationshipRow, userId: string): Relationship {
  return { user: toPublicUser(getUser(userId)), kind: kindFor(row, row.requesterId), createdAt: row.createdAt };
}

/** Single relationship between the viewer and `userId`, or null. */
export function relationshipKind(actorId: string, userId: string): RelationshipKind | null {
  const row = rowBetween(actorId, userId);
  return row ? kindFor(row, actorId) : null;
}

export function getFriendsOverview(userId: string): FriendsOverview {
  const userCache = new Map<string, PublicUser>();
  const publicUser = (id: string): PublicUser => {
    if (!userCache.has(id)) userCache.set(id, toPublicUser(getUser(id)));
    return userCache.get(id)!;
  };

  const overview: FriendsOverview = { friends: [], incoming: [], outgoing: [], blocked: [] };
  for (const row of rowsFor(userId)) {
    const otherId = row.requesterId === userId ? row.addresseeId : row.requesterId;
    const kind = kindFor(row, userId);
    const entry: Relationship = { user: publicUser(otherId), kind, createdAt: row.createdAt };
    if (kind === 'friend') overview.friends.push(entry);
    else if (kind === 'incoming') overview.incoming.push(entry);
    else if (kind === 'outgoing') overview.outgoing.push(entry);
    else if (kind === 'blocked') overview.blocked.push(entry);
  }
  const byName = (a: Relationship, b: Relationship) => a.user.displayName.localeCompare(b.user.displayName);
  overview.friends.sort(byName);
  overview.incoming.sort(byName);
  overview.outgoing.sort(byName);
  overview.blocked.sort(byName);
  return overview;
}

function notify(userIds: string[]): void {
  for (const id of userIds) hub.emitToUsers([id], { type: 'friends:update', friends: getFriendsOverview(id) });
}

export function sendFriendRequest(actorId: string, targetId: string): { created: boolean } {
  if (actorId === targetId) throw badRequest('Você não pode adicionar a si mesmo.');
  getUser(targetId);

  const existing = rowBetween(actorId, targetId);
  if (existing) {
    if (existing.kind === 'blocked') {
      // a block silently swallows the request, like Discord
      if (existing.requesterId === actorId) throw badRequest('Desbloqueie este usuário antes de enviar um pedido.');
      return { created: false };
    }
    if (existing.kind === 'accepted') throw conflict('Vocês já são amigos.');
    if (existing.requesterId === actorId) throw conflict('Pedido de amizade já enviado.');
    // the other side had already asked: accepting is the natural outcome
    acceptFriendRequest(actorId, targetId);
    return { created: false };
  }

  db.insert(schema.relationships)
    .values({ requesterId: actorId, addresseeId: targetId, kind: 'pending', createdAt: nowIso() })
    .run();
  notify([actorId, targetId]);
  return { created: true };
}

export function acceptFriendRequest(actorId: string, targetId: string): void {
  const row = rowBetween(actorId, targetId);
  if (!row || row.kind !== 'pending') throw notFound('Nenhum pedido de amizade pendente.');
  // either side may confirm: the addressee accepts, the requester completes a crossed request
  if (row.addresseeId !== actorId && row.requesterId !== actorId) throw forbidden('Pedido inválido.');
  db.update(schema.relationships)
    .set({ kind: 'accepted' })
    .where(and(eq(schema.relationships.requesterId, row.requesterId), eq(schema.relationships.addresseeId, row.addresseeId)))
    .run();
  notify([actorId, targetId]);
}

/** Declines an incoming request (or cancels an outgoing one). */
export function declineFriendRequest(actorId: string, targetId: string): void {
  const row = rowBetween(actorId, targetId);
  if (!row || row.kind !== 'pending') throw notFound('Nenhum pedido de amizade pendente.');
  if (row.requesterId !== actorId && row.addresseeId !== actorId) throw forbidden('Pedido inválido.');
  db.delete(schema.relationships)
    .where(and(eq(schema.relationships.requesterId, row.requesterId), eq(schema.relationships.addresseeId, row.addresseeId)))
    .run();
  notify([actorId, targetId]);
}

/** Removes a friendship (or withdraws a pending request). */
export function removeFriend(actorId: string, targetId: string): void {
  const row = rowBetween(actorId, targetId);
  if (!row || (row.kind !== 'accepted' && row.kind !== 'pending')) {
    throw notFound('Este usuário não está na sua lista de amigos.');
  }
  db.delete(schema.relationships)
    .where(and(eq(schema.relationships.requesterId, row.requesterId), eq(schema.relationships.addresseeId, row.addresseeId)))
    .run();
  notify([actorId, targetId]);
}

/**
 * Blocking replaces any pending/accepted relationship in both directions, so
 * the blocked user can no longer send DMs, requests or reply to the blocker.
 */
export function blockUser(actorId: string, targetId: string): void {
  if (actorId === targetId) throw badRequest('Você não pode bloquear a si mesmo.');
  getUser(targetId);
  const existing = rowBetween(actorId, targetId);
  if (existing?.kind === 'blocked' && existing.requesterId === actorId) return;

  // blocked rows are NOT id-ordered: the blocker is always `requester_id`, so
  // the direction survives a round trip
  db.transaction((tx) => {
    tx.delete(schema.relationships).where(pairCondition(actorId, targetId)).run();
    tx.insert(schema.relationships)
      .values({ requesterId: actorId, addresseeId: targetId, kind: 'blocked', createdAt: nowIso() })
      .run();
  });
  notify([actorId, targetId]);
}

export function unblockUser(actorId: string, targetId: string): void {
  const row = rowBetween(actorId, targetId);
  if (!row || row.kind !== 'blocked' || row.requesterId !== actorId) {
    throw notFound('Este usuário não está bloqueado por você.');
  }
  db.delete(schema.relationships)
    .where(and(eq(schema.relationships.requesterId, row.requesterId), eq(schema.relationships.addresseeId, row.addresseeId)))
    .run();
  notify([actorId, targetId]);
}

/** Friend ids, used to render the sidebar with presence. */
export function friendIds(userId: string): string[] {
  return rowsFor(userId)
    .filter((row) => row.kind === 'accepted')
    .map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId));
}
