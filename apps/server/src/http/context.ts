import type { Context } from 'hono';
import type { UserRow } from '../db/schema';

export type AppVariables = {
  currentUser: UserRow;
  origin: string;
};

export type AppContext = Context<{ Variables: AppVariables }>;
