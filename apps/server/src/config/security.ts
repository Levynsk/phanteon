/**
 * Startup checks for settings that are safe to leave open on a dev machine and
 * dangerous to leave open anywhere else. Kept pure so the rules are testable
 * without booting the server.
 */

const DEV_SECRET = 'phanteon-dev-secret-change-me';
const MIN_SECRET_LENGTH = 32;

export interface SecurityConfigInput {
  jwtSecret: string;
  corsOrigins: string[];
}

export function isProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production';
}

/**
 * Returns every problem found. The caller decides what to do: in production any
 * problem aborts startup; elsewhere the same list is logged as warnings.
 */
export function checkSecurityConfig({ jwtSecret, corsOrigins }: SecurityConfigInput): string[] {
  const problems: string[] = [];
  if (jwtSecret === DEV_SECRET || jwtSecret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET precisa ser definido com pelo menos ${MIN_SECRET_LENGTH} caracteres aleatórios ` +
        '(o valor de desenvolvimento é público e permite forjar sessões).',
    );
  }
  if (corsOrigins.includes('*')) {
    problems.push('CORS_ORIGINS precisa listar as origens do app; o curinga aceita qualquer site.');
  }
  return problems;
}
