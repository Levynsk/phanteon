/**
 * Entry point for running the API from the project root — the shape a managed
 * host expects (`bun run server.ts`), without the workspace resolution that a
 * `bun install` of the whole monorepo would need.
 *
 * `@phanteon/shared` is plain TypeScript, so the tsconfig `paths` below map
 * it straight to `packages/shared/src` and Bun compiles it along with the server.
 */
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir);
export const SHARED_ROOT = resolve(ROOT, 'packages/shared');
export const SERVER_ROOT = resolve(ROOT, 'apps/server');

/**
 * The server reads its data directory relative to its own folder, which lands
 * inside the workspace when run from the root. Keep the files where the dev
 * scripts already put them, or in `DATA_DIR` when the host provides one.
 */
process.env.DATA_DIR ??= resolve(SERVER_ROOT, 'data');

// Loading the server starts the HTTP + WebSocket listener and runs migrations.
await import(resolve(SERVER_ROOT, 'src/index.ts'));
