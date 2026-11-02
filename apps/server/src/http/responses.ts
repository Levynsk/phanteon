import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppError, ErrorCode } from './errors';

export interface JsonError {
  error: { code: ErrorCode; message: string; details?: Record<string, string> };
}

export function errorResponse(error: AppError): { status: ContentfulStatusCode; body: JsonError } {
  return {
    status: error.status as ContentfulStatusCode,
    body: { error: { code: error.code, message: error.message, details: error.details } },
  };
}

export const internalErrorResponse: { status: ContentfulStatusCode; body: JsonError } = {
  status: 500,
  body: { error: { code: 'INTERNAL', message: 'Erro interno do servidor.' } },
};
