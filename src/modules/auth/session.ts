import { createHash, randomBytes } from 'node:crypto';
import { SESSION } from '../../platform/config/constants';
import type { SessionWithUserRow } from './repo';

/** 256 random bits as 43 base64url characters. The raw value is never stored or logged. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex: the only form of the token that reaches the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function absoluteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION.absoluteDays * 86_400_000);
}

export function idleDeadline(lastSeenAt: Date): Date {
  return new Date(lastSeenAt.getTime() + SESSION.idleMinutes * 60_000);
}

/** Not revoked, inside both the absolute and the idle limit, and the user is still active. */
export function isSessionLive(row: SessionWithUserRow, now: Date): boolean {
  if (row.revoked_at !== null) return false;
  if (!row.is_active) return false;
  if (now.getTime() >= row.expires_at.getTime()) return false;
  if (now.getTime() >= idleDeadline(row.last_seen_at).getTime()) return false;
  return true;
}

export function shouldTouch(row: SessionWithUserRow, now: Date): boolean {
  return now.getTime() - row.last_seen_at.getTime() >= SESSION.touchIntervalSeconds * 1000;
}
