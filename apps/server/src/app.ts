import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config } from './config/env';
import { requireAuth } from './auth/middleware';
import type { AppVariables } from './http/context';
import { AppError, tooManyRequests } from './http/errors';
import { rateLimits, UNFURL_RULE } from './http/rate-limit';
import { withOrigin } from './http/origin';
import { errorResponse, internalErrorResponse } from './http/responses';
import { authRoutes } from './routes/auth';
import { channelRoutes } from './routes/channels';
import { friendRoutes } from './routes/friends';
import { guildRoutes } from './routes/guilds';
import { inviteRoutes } from './routes/invites';
import { unfurlRoutes } from './routes/unfurl';
import { dmRoutes, memberRoutes, presenceRoutes, reactionRoutes } from './routes/social';
import { fileRoutes, uploadRoutes } from './routes/uploads';
import { userRoutes } from './routes/users';
import { voiceRoutes } from './routes/voice';

export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: (origin) =>
        config.corsOrigins.includes('*') || config.corsOrigins.includes(origin) ? origin : '',
      allowHeaders: ['Authorization', 'Content-Type', 'Range'],
      exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Disposition'],
      allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: false,
    }),
  );
  // personal data in JSON answers must never be kept by a proxy or the browser cache
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
  });
  app.use('/api/*', withOrigin);
  // uploaded files follow the same session rule as the API
  app.use('/files/*', requireAuth);

  app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

  app.route('/api/auth', authRoutes);

  const api = new Hono<{ Variables: AppVariables }>();
  api.use('*', requireAuth);

  api.route('/guilds', guildRoutes);
  api.route('/invites', inviteRoutes);
  api.route('/friends', friendRoutes);
  // each preview fetches a third-party page; bound it before the route runs
  api.use('/unfurl', async (c, next) => {
    const quota = rateLimits.hit(`unfurl:${c.get('currentUser').id}`, UNFURL_RULE);
    if (!quota.allowed) {
      c.header('Retry-After', String(Math.ceil(quota.retryAfterMs / 1000)));
      throw tooManyRequests('Muitas pré-visualizações de link. Aguarde um instante.');
    }
    await next();
  });
  api.route('/unfurl', unfurlRoutes);
  api.route('/channels', channelRoutes);
  api.route('/dms', dmRoutes);
  api.route('/messages', reactionRoutes);
  api.route('/uploads', uploadRoutes);
  api.route('/users', userRoutes);
  api.route('/members', memberRoutes);
  api.route('/presence', presenceRoutes);
  api.route('/voice', voiceRoutes);
  app.route('/api', api);
  app.route('/files', fileRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: `Rota não encontrada: ${c.req.path}` } }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof AppError) {
      const { status, body } = errorResponse(error);
      return c.json(body, status);
    }
    console.error('[unhandled]', error);
    return c.json(internalErrorResponse.body, internalErrorResponse.status);
  });

  return app;
}
