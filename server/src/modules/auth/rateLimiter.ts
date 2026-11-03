import { realSystemTimeMs } from '../../core/realTime';

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes in real time
export const MAX_FAILED_ATTEMPTS = 5;

// In-memory tracker: key -> array of failure timestamps in realSystemTimeMs
const failedAttemptsMap = new Map<string, number[]>();

function buildKey(email: string, ip: string): string {
  return `${email.toLowerCase().trim()}:${ip.trim()}`;
}

function getActiveFailures(key: string, nowMs: number): number[] {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const attempts = failedAttemptsMap.get(key);
  if (!attempts) return [];
  const active = attempts.filter((timestamp) => timestamp > cutoff);
  if (active.length > 0) {
    failedAttemptsMap.set(key, active);
  } else {
    failedAttemptsMap.delete(key);
  }
  return active;
}

/**
 * Checks whether an (email, ip) pair has exceeded the 5 failed attempts in 15 minutes threshold.
 * Uses real system time, not the demo clock.
 */
export function isLoginRateLimited(email: string, ip: string): boolean {
  const nowMs = realSystemTimeMs();
  const key = buildKey(email, ip);
  const active = getActiveFailures(key, nowMs);
  return active.length >= MAX_FAILED_ATTEMPTS;
}

/**
 * Records a failed login attempt for an (email, ip) pair.
 * Counts failures only.
 */
export function recordLoginFailure(email: string, ip: string): void {
  const nowMs = realSystemTimeMs();
  const key = buildKey(email, ip);
  const active = getActiveFailures(key, nowMs);
  active.push(nowMs);
  failedAttemptsMap.set(key, active);
}

/**
 * Resets the in-memory failure tracker (used in automated tests).
 */
export function resetRateLimiter(): void {
  failedAttemptsMap.clear();
}

