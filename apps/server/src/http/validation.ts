import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import { AppError } from './errors';

export function jsonBody<S extends z.ZodType>(schema: S) {
  return zValidator('json', schema, (result) => {
    if (result.success) return;
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      details[key] ??= issue.message;
    }
    throw new AppError('BAD_REQUEST', 'Dados inválidos.', details);
  });
}

export function queryParams<S extends z.ZodType>(schema: S) {
  return zValidator('query', schema, (result) => {
    if (result.success) return;
    throw new AppError('BAD_REQUEST', result.error.issues[0]?.message ?? 'Parâmetros inválidos.');
  });
}
