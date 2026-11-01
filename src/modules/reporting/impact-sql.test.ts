import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The public impact repository may only read approved aggregates and active branch names.
// The whole file is scanned, so a forbidden column cannot hide in a comment or a template.
const SOURCE = readFileSync(path.resolve(import.meta.dirname, 'repo-impact.ts'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

const FORBIDDEN = [
  'is_pending_approval',
  'is_in_progress',
  'is_not_yet_routed',
  'is_routed',
  'routed_at',
  'purpose',
  'note',
  'email',
  'phone',
  'full_name',
  'users',
  'members',
  'applications',
];

describe('repo-impact SQL', () => {
  it('filters money by the approved predicate of the shared view', () => {
    expect(SOURCE).toMatch(/v_kpi_collections/);
    expect(SOURCE).toMatch(/\bk\.is_approved\b/);
  });

  it('lists only active branches', () => {
    expect(SOURCE).toMatch(/status = 'active'/);
  });

  it.each(FORBIDDEN)('never mentions %s', (word) => {
    expect(SOURCE.toLowerCase()).not.toContain(word);
  });

  it('never selects every column', () => {
    expect(SOURCE).not.toMatch(/\.\*|SELECT \*/);
  });

  it('never filters on a status other than approved or active', () => {
    for (const match of SOURCE.matchAll(/status\s*=\s*'([a-z_]+)'/g)) {
      expect(['approved', 'active']).toContain(match[1]);
    }
  });
});
