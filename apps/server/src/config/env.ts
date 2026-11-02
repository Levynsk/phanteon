import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const serverRoot = resolve(import.meta.dir, '../..');
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(serverRoot, 'data');

function turnUrls(): string[] {
  const raw = process.env.TURN_URLS?.trim();
  if (!raw) return [];
  // the list is comma separated and each entry may carry `?transport=...`
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * Development secret: random and stored next to the database, so restarting the
 * server keeps sessions alive without shipping a known value in the repository.
 * Production must set JWT_SECRET; `assertSecureConfig` stops it otherwise.
 */
const DEV_SECRET_FILE = 'dev-jwt-secret';

let generatedSecret: string | null = null;

function jwtSecret(): string {
  if (generatedSecret) return generatedSecret;
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const path = join(dataDir, DEV_SECRET_FILE);
  if (existsSync(path)) {
    generatedSecret = readFileSync(path, 'utf8').trim();
    return generatedSecret;
  }
  const generated = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64url');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, generated, { mode: 0o600 });
  generatedSecret = generated;
  return generated;
}

export const config = {
  port: Number(process.env.PORT ?? 3010),
  dataDir,
  databasePath: process.env.DATABASE_PATH ?? join(dataDir, 'app.db'),
  uploadsDir: join(dataDir, 'uploads'),
  nodeEnv: process.env.NODE_ENV,
  jwtSecret: jwtSecret(),
  /** Signs the short-lived `/files` URLs; derived from the session secret unless set. */
  fileLinkSecret: process.env.FILE_URL_SECRET?.trim() || `${jwtSecret()}:files`,
  jwtIssuer: 'phanteon-server',
  sessionTtlSeconds: process.env.SESSION_TTL_SECONDS ? Number(process.env.SESSION_TTL_SECONDS) : 60 * 60 * 24 * 7,
  /** Unset in development (any origin); required in production, see `assertSecureConfig`. */
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : (['*'] as string[]),
  /**
   * Public STUN servers always offered; the app merges these with the relay.
   * Kept in the server so ICE never has to be duplicated across platforms.
   */
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  /**
   * TURN relay for calls that cannot connect peer to peer. Credentials come
   * from the environment only, so they never live in the repository.
   */
  turn: {
    urls: turnUrls(),
    username: process.env.TURN_USERNAME?.trim() ?? '',
    credential: process.env.TURN_CREDENTIAL?.trim() ?? '',
  },
} as const;

export function ensureDataDirs(): void {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.uploadsDir, { recursive: true });
}
