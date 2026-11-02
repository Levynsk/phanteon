import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { config, ensureDataDirs } from '../config/env';
import * as schema from './schema';

ensureDataDirs();

export const sqlite = new Database(config.databasePath, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');
sqlite.exec('PRAGMA busy_timeout = 5000;');

export const db = drizzle(sqlite, { schema });

export { schema };
export type Db = typeof db;
