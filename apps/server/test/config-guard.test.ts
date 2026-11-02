import { describe, expect, test } from 'bun:test';
import { checkSecurityConfig, isProduction } from '../src/config/security';

const strong = 'x'.repeat(64);

describe('startup security guard', () => {
  test('refuses to start in production with the built-in secret', () => {
    const problems = checkSecurityConfig({ jwtSecret: 'phanteon-dev-secret-change-me', corsOrigins: ['https://app.example'] });
    expect(problems.some((problem) => problem.includes('JWT_SECRET'))).toBe(true);
  });

  test('refuses a short secret in production', () => {
    const problems = checkSecurityConfig({ jwtSecret: 'curto', corsOrigins: ['https://app.example'] });
    expect(problems.some((problem) => problem.includes('JWT_SECRET'))).toBe(true);
    expect(checkSecurityConfig({ jwtSecret: strong, corsOrigins: ['https://app.example'] })).toEqual([]);
  });

  test('refuses wildcard CORS in production', () => {
    const problems = checkSecurityConfig({ jwtSecret: strong, corsOrigins: ['*'] });
    expect(problems.some((problem) => problem.includes('CORS_ORIGINS'))).toBe(true);
  });

  test('development only warns', () => {
    const warnings = checkSecurityConfig({ jwtSecret: 'phanteon-dev-secret-change-me', corsOrigins: ['*'] });
    expect(warnings).toHaveLength(2);
    expect(checkSecurityConfig({ jwtSecret: strong, corsOrigins: ['http://localhost:5173'] })).toEqual([]);
    // development is never stopped, even when problems are reported
    expect(isProduction('development')).toBe(false);
    expect(isProduction('production')).toBe(true);
  });
});
