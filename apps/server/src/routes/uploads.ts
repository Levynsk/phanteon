import { Hono, type Context } from 'hono';
import type { AppVariables } from '../http/context';
import { badRequest, tooManyRequests } from '../http/errors';
import { rateLimits, UPLOAD_RULE } from '../http/rate-limit';
import { config } from '../config/env';
import { hidden } from '../http/errors';
import { verifyFileSignature } from '../services/file-links';
import {
  canReadAttachment,
  discardAttachment,
  findAttachmentByUrl,
  getServedFile,
  SAFE_FILENAME,
  GUILD_IMAGE,
  saveAttachment,
} from '../services/uploads';

export const uploadRoutes = new Hono<{ Variables: AppVariables }>();

uploadRoutes.post('/', async (c) => {
  const quota = rateLimits.hit(`upload:${c.get('currentUser').id}`, UPLOAD_RULE);
  if (!quota.allowed) {
    c.header('Retry-After', String(Math.ceil(quota.retryAfterMs / 1000)));
    throw tooManyRequests('Muitos envios seguidos. Aguarde um instante.');
  }
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) throw badRequest('Envie um arquivo no campo "file".');
  const attachment = await saveAttachment(c.get('currentUser').id, file, c.get('origin'));
  return c.json({ attachment }, 201);
});

uploadRoutes.delete('/:attachmentId', async (c) => {
  await discardAttachment(c.get('currentUser').id, c.req.param('attachmentId'));
  return c.body(null, 204);
});

/**
 * Authorised read access to uploaded files. Mounted at `/files` (behind a session):
 * profile and guild images are open to any signed-in user, while message
 * attachments require a signature issued to someone who may see them.
 */
export const fileRoutes = new Hono<{ Variables: AppVariables }>();

const PRIVATE_CACHE = 'private, max-age=300';

function assertCanServe(filename: string, userId: string, query: Record<string, string | undefined>): void {
  if (SAFE_FILENAME.test(filename) && GUILD_IMAGE.test(filename)) return;
  const url = `/files/${filename}`;
  const attachment = findAttachmentByUrl(url);
  // profile images are not attachments: the URL was handed out by the API to a session
  if (!attachment) return;
  if (canReadAttachment(url, userId)) return;
  if (verifyFileSignature(config.fileLinkSecret, filename, query)) return;
  throw hidden('Arquivo não encontrado.');
}

async function serveFile(c: Context<{ Variables: AppVariables }>, status = 200, extra: Record<string, string> = {}) {
  const filename = c.req.param('file')!;
  assertCanServe(filename, c.get('currentUser').id, { exp: c.req.query('exp'), sig: c.req.query('sig') });
  const { path, mimeType, inline } = await getServedFile(filename);
  const bytes = Bun.file(path);
  return c.body(bytes.stream(), status as never, {
    'Content-Type': mimeType,
    'Content-Length': String(bytes.size),
    'Accept-Ranges': 'bytes',
    'Cache-Control': PRIVATE_CACHE,
    'Content-Disposition': inline ? 'inline' : 'attachment',
    // user uploads are never executed as a page
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    ...extra,
  } as never);
}

fileRoutes.get('/:file', (c) => serveFile(c));

fileRoutes.on('HEAD', '/:file', (c) => serveFile(c, 200));
