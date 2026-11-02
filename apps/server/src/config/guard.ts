import { config } from './env';
import { checkSecurityConfig, isProduction } from './security';

/**
 * Called once before the server starts. In production a known secret or a
 * wildcard CORS policy aborts startup; anywhere else the same findings are
 * printed as warnings so a dev setup still runs.
 */
export function assertSecureConfig(): void {
  const problems = checkSecurityConfig({ jwtSecret: config.jwtSecret, corsOrigins: config.corsOrigins });
  if (problems.length === 0) return;
  if (isProduction(config.nodeEnv)) {
    for (const problem of problems) console.error(`[config] ${problem}`);
    throw new Error(`Configuração insegura em produção (${problems.length} problema(s)); o servidor não vai iniciar.`);
  }
  for (const problem of problems) console.warn(`[config] aviso: ${problem}`);
}
