/**
 * In-memory fixed-window limiter for the endpoints that cost the most to abuse:
 * password checks, link previews and uploads. Per-process on purpose — a single
 * node is what this server ships as; a shared store would be needed for several.
 */

export interface RateLimitRule {
  /** Attempts allowed per window. */
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * Counts one attempt for `key`. Returns false when the key is over its quota;
   * `retryAfterMs` says when the window opens again.
   */
  hit(key: string, rule: RateLimitRule, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      this.sweep(now);
      return { allowed: true, retryAfterMs: rule.windowMs };
    }
    bucket.count += 1;
    return { allowed: bucket.count <= rule.limit, retryAfterMs: bucket.resetAt - now };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export const LOGIN_RULES = {
  perIdentifier: { limit: 10, windowMs: 15 * 60 * 1000 },
  perClient: { limit: 50, windowMs: 15 * 60 * 1000 },
} as const;

export const UNFURL_RULE: RateLimitRule = { limit: 60, windowMs: 60 * 1000 };
export const UPLOAD_RULE: RateLimitRule = { limit: 60, windowMs: 60 * 1000 };

export const rateLimits = new RateLimiter();

/**
 * The socket address as seen by this process. Behind a reverse proxy the proxy's
 * address is what counts: a shared store or trusted-proxy parsing is needed
 * before the per-client window can tell real clients apart.
 */
export function clientIp(header: ((name: string) => string | undefined) | { get(name: string): string | undefined }): string {
  const get = typeof header === 'function' ? header : (name: string) => header.get(name);
  const forwarded = get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || get('x-real-ip') || 'local';
}
