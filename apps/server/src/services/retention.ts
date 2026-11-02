import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { deleteUploadedFiles } from './uploads';

/** Prazos de retenção. Mudar um deles muda o que o servidor guarda de cada pessoa. */
export const RETENTION = {
  /** Unused invites older than this are deleted, unless they never expire. */
  inviteIdleDays: 30,
  /** Attachments that never made it into a message are deleted after this long. */
  orphanUploadHours: 24,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function isoBefore(msAgo: number, now = Date.now()): string {
  return new Date(now - msAgo).toISOString();
}

/**
 * Removes invites that were created long ago, never used and never expire, and
 * uploads that were never attached to a message. Both are personal data whose
 * only purpose has passed (LGPD art. 15/16: storage limited to the needed time).
 * Files are removed from disk only after the rows are gone, and only when nothing
 * else points at them.
 */
export async function purgeExpiredData(now = Date.now()): Promise<{ invites: number; uploads: number }> {
  const idleInvites = db
    .select({ code: schema.invites.code })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.uses, 0),
        isNotNull(schema.invites.createdAt),
        lt(schema.invites.createdAt, isoBefore(RETENTION.inviteIdleDays * DAY_MS, now)),
      ),
    )
    .all()
    .map((row) => row.code);

  for (const code of idleInvites) db.delete(schema.invites).where(eq(schema.invites.code, code)).run();

  const orphans = db
    .select({ id: schema.attachments.id, url: schema.attachments.url })
    .from(schema.attachments)
    .where(lt(schema.attachments.createdAt, isoBefore(RETENTION.orphanUploadHours * 60 * 60 * 1000, now)))
    .all()
    .filter((row) => {
      const linked = db
        .select({ messageId: schema.messageAttachments.messageId })
        .from(schema.messageAttachments)
        .where(eq(schema.messageAttachments.attachmentId, row.id))
        .get();
      const legacy = db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.attachmentId, row.id))
        .get();
      return !linked && !legacy;
    });

  for (const row of orphans) db.delete(schema.attachments).where(eq(schema.attachments.id, row.id)).run();
  await deleteUploadedFiles(orphans.map((row) => row.url));

  return { invites: idleInvites.length, uploads: orphans.length };
}

/** Oldest rows first, so a manual inspection can list what the next purge takes. */
export function retentionPreview(now = Date.now()): { invites: string[]; uploads: string[] } {
  return {
    invites: db
      .select({ code: schema.invites.code })
      .from(schema.invites)
      .where(and(eq(schema.invites.uses, 0), lt(schema.invites.createdAt, isoBefore(RETENTION.inviteIdleDays * DAY_MS, now))))
      .orderBy(asc(schema.invites.createdAt))
      .all()
      .map((row) => row.code),
    uploads: db
      .select({ id: schema.attachments.id })
      .from(schema.attachments)
      .where(lt(schema.attachments.createdAt, isoBefore(RETENTION.orphanUploadHours * 60 * 60 * 1000, now)))
      .all()
      .map((row) => row.id),
  };
}
