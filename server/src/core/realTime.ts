/**
 * Real system wall-clock time helper.
 *
 * EXCEPTION JUSTIFICATION:
 * The CareLoop system uses an injectable DatabaseClock (core/clock.ts) for business
 * logic, case workflow states, SLAs, event logs, and audit records to enable controllable
 * simulation and demonstration by advancing simulated time.
 *
 * In contrast, security and transport infrastructure — specifically JWT token issuance
 * (iat/exp), session cookie expiration, and authentication rate-limiting windows —
 * MUST strictly use the real host system wall-clock time. If security infrastructure
 * tracked the simulated demo clock, advancing the demo clock to simulate SLA breaches
 * would inadvertently log users out or disrupt rate-limit throttling windows.
 */

/** Returns the real system wall-clock Date. */
export function realSystemTime(): Date {
  return new Date();
}

/** Returns the real system wall-clock time in milliseconds since Unix epoch. */
export function realSystemTimeMs(): number {
  return Date.now();
}
