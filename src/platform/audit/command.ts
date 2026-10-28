import type { PoolClient } from 'pg';
import { withTransaction } from '../db';
import { snapshotChanges } from './mask';
import type { AuditEventInput, CommandContext } from './types';

/**
 * Names allowed to run with `ctx.actor === null`. They record actor_role 'system' and a
 * NULL actor_id. A null actor is never an escape hatch for a normal command: a command
 * that acts for an authenticated user (including `auth.login`) must be given that user's
 * Actor. The login service builds it from the verified user row after the password check,
 * so the auth.login audit row carries the real actor id and role.
 */
export const SYSTEM_COMMANDS: readonly string[] = ['auth.record_failed_login'];

/** Names allowed to commit with zero audit events (`opts.audit === 'none'`). */
export const COMMANDS_WITHOUT_AUDIT: readonly string[] = ['auth.record_failed_login'];

/** Every command name that reached command(), for a later registry test. */
export const COMMAND_NAMES_SEEN = new Set<string>();

/** Programming error: a command finished without recording any audit event. */
export class MissingAuditError extends Error {
  constructor(commandName: string) {
    super(`Command ${commandName} emitted no audit event`);
    this.name = 'MissingAuditError';
  }
}

/** Programming error: command() was called in a way the contract forbids. */
export class CommandContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandContractError';
  }
}

type AuditFn = (event: AuditEventInput) => void;

// Exactly one transaction per request: a ctx may not start a command while one is running.
const IN_FLIGHT = new WeakSet<CommandContext>();

interface PreparedEvent {
  input: AuditEventInput;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function prepare(event: AuditEventInput): PreparedEvent {
  if (!event.action || !event.entityType || !event.entityId) {
    throw new Error('Audit event needs action, entityType and entityId');
  }
  const { before, after } = snapshotChanges(event.entityType, event.before, event.after);
  return { input: event, before, after };
}

const INSERT_AUDIT = `
  INSERT INTO audit_events
    (request_id, actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, before, after)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`;

/**
 * Runs `fn` in one transaction and writes the audit events it emitted through the same
 * transaction handle, so the change and its audit rows commit or roll back together.
 * Refuses to commit with zero audit events unless the name is in COMMANDS_WITHOUT_AUDIT.
 */
export async function command<T>(
  ctx: CommandContext,
  name: string,
  fn: (tx: PoolClient, audit: AuditFn) => Promise<T>,
  opts?: { audit?: 'none' },
): Promise<T> {
  COMMAND_NAMES_SEEN.add(name);

  if (IN_FLIGHT.has(ctx)) {
    throw new CommandContractError(
      `Command ${name}: a command is already in flight on this context`,
    );
  }
  if (opts?.audit === 'none' && !COMMANDS_WITHOUT_AUDIT.includes(name)) {
    throw new CommandContractError(
      `Command ${name} may not skip audit; it is not in COMMANDS_WITHOUT_AUDIT`,
    );
  }
  if (ctx.actor === null && !SYSTEM_COMMANDS.includes(name)) {
    throw new CommandContractError(
      `Command ${name} requires an actor; it is not in SYSTEM_COMMANDS`,
    );
  }

  IN_FLIGHT.add(ctx);
  try {
    return await withTransaction(ctx.pool, async (tx) => {
      const buffer: PreparedEvent[] = [];
      let auditError: unknown;
      const audit: AuditFn = (event) => {
        try {
          buffer.push(prepare(event));
        } catch (err) {
          auditError ??= err;
          throw err;
        }
      };

      const result = await fn(tx, audit);

      // an invalid audit call must fail the command even if fn swallowed the throw
      if (auditError) throw auditError;
      if (buffer.length === 0 && opts?.audit !== 'none') throw new MissingAuditError(name);

      const actorId = ctx.actor?.userId ?? null;
      const actorRole = ctx.actor?.role ?? 'system';
      for (const { input, before, after } of buffer) {
        await tx.query(INSERT_AUDIT, [
          ctx.requestId,
          actorId,
          actorRole,
          input.action,
          input.entityType,
          input.entityId,
          input.branchId ?? null,
          input.reportId ?? null,
          before === null ? null : JSON.stringify(before),
          after === null ? null : JSON.stringify(after),
        ]);
      }
      return result;
    });
  } finally {
    IN_FLIGHT.delete(ctx);
  }
}
