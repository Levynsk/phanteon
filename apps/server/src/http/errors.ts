export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, string>) =>
  new AppError('BAD_REQUEST', message, details);
export const unauthorized = (message = 'Você precisa estar autenticado.') =>
  new AppError('UNAUTHORIZED', message);
export const forbidden = (message = 'Você não tem permissão para isso.') =>
  new AppError('FORBIDDEN', message);
export const notFound = (message = 'Recurso não encontrado.') => new AppError('NOT_FOUND', message);

/**
 * One answer for "missing or not yours", so a 404 cannot tell an attacker that
 * a private resource exists.
 */
export const hidden = (message = 'Recurso não encontrado.') => new AppError('NOT_FOUND', message);
export const tooManyRequests = (message: string) => new AppError('TOO_MANY_REQUESTS', message);
export const conflict = (message: string, details?: Record<string, string>) =>
  new AppError('CONFLICT', message, details);
