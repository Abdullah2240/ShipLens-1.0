import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  Conflict,
  Forbidden,
  NotFound,
  RateLimited,
  Unauthenticated,
  ValidationFailed,
  mapError,
} from './index';

const REQUEST_ID = 'req-123';

describe('AppError hierarchy', () => {
  it('carries status and code', () => {
    expect(new Unauthenticated()).toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(new Forbidden()).toMatchObject({ status: 403, code: 'forbidden' });
    expect(new NotFound()).toMatchObject({ status: 404, code: 'not_found' });
    expect(new Conflict('report_locked')).toMatchObject({ status: 409, code: 'report_locked' });
    expect(new ValidationFailed([])).toMatchObject({ status: 422, code: 'validation_failed' });
    expect(new RateLimited(30)).toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('is an Error and an AppError', () => {
    const err = new NotFound();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('mapError', () => {
  it('maps each AppError to its status and one body shape', () => {
    const cases: Array<[AppError, number, string]> = [
      [new Unauthenticated(), 401, 'unauthenticated'],
      [new Forbidden(), 403, 'forbidden'],
      [new NotFound(), 404, 'not_found'],
      [new Conflict('wrong_state'), 409, 'wrong_state'],
      [
        new ValidationFailed([{ path: 'a', code: 'invalid_type', message: 'bad' }]),
        422,
        'validation_failed',
      ],
      [new RateLimited(12), 429, 'rate_limited'],
    ];
    for (const [err, status, code] of cases) {
      const mapped = mapError(err, REQUEST_ID);
      expect(mapped.status).toBe(status);
      expect(mapped.body.error.code).toBe(code);
      expect(mapped.body.error.requestId).toBe(REQUEST_ID);
      expect(typeof mapped.body.error.message).toBe('string');
    }
  });

  it('puts validation fields under details.fields', () => {
    const fields = [{ path: 'amount', code: 'invalid_money', message: 'invalid_money' }];
    const mapped = mapError(new ValidationFailed(fields), REQUEST_ID);
    expect(mapped.body.error.details).toEqual({ fields });
  });

  it('adds Retry-After and retryAfterSeconds for rate limiting', () => {
    const mapped = mapError(new RateLimited(42), REQUEST_ID);
    expect(mapped.headers['Retry-After']).toBe('42');
    expect(mapped.body.error.details).toEqual({ retryAfterSeconds: 42 });
  });

  it('does not set Retry-After for other errors', () => {
    expect(mapError(new Forbidden(), REQUEST_ID).headers['Retry-After']).toBeUndefined();
  });

  it('gives missing and out-of-scope 404s byte-identical bodies', () => {
    const a = mapError(new NotFound(), REQUEST_ID);
    const b = mapError(new NotFound(), REQUEST_ID);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    expect(JSON.stringify(a.body)).not.toMatch(/branch|collection|report|"id"/i);
    expect(a.body.error.details).toBeUndefined();
  });

  it('maps unknown errors to a fixed 500 without leaking internals', () => {
    const err = new Error('connection to db-prod.internal refused');
    const mapped = mapError(err, REQUEST_ID);
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe('internal_error');
    expect(mapped.body.error.message).toBe('Internal error');
    const serialised = JSON.stringify(mapped.body);
    expect(serialised).not.toContain('db-prod');
    expect(serialised).not.toContain('stack');
    expect(serialised).not.toContain('.ts:');
  });

  it('maps non-Error throwables to 500', () => {
    expect(mapError('boom', REQUEST_ID).status).toBe(500);
    expect(mapError(undefined, REQUEST_ID).status).toBe(500);
  });

  it('maps ZodError to 422 with sorted fields and no input echo', () => {
    const schema = z.object({
      b: z.string(),
      a: z.object({ c: z.number() }),
    });
    const result = schema.safeParse({ b: 5, a: { c: 'secret-input-value' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = mapError(result.error, REQUEST_ID);
    expect(mapped.status).toBe(422);
    expect(mapped.body.error.code).toBe('validation_failed');
    const fields = (mapped.body.error.details as { fields: Array<{ path: string }> }).fields;
    expect(fields.map((f) => f.path)).toEqual(['a.c', 'b']);
    for (const field of fields) {
      expect(Object.keys(field).sort()).toEqual(['code', 'message', 'path']);
    }
    expect(JSON.stringify(mapped.body)).not.toContain('secret-input-value');
  });
});
