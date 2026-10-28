declare const scopeBrand: unique symbol;

type ScopeShape = { readonly kind: 'all' } | { readonly kind: 'branch'; readonly branchId: string };

/**
 * What a permitted actor may see. The brand is type-only: object literals do not
 * typecheck as a Scope, so repositories can only be called with a value from authorize().
 */
export type Scope = ScopeShape & { readonly [scopeBrand]: true };

/** Internal to authz: used by authorize() only, not re-exported from the index. */
export function mintScope(shape: ScopeShape): Scope {
  return Object.freeze({ ...shape }) as Scope;
}

const COLUMN_PATTERN = /^[a-z_][a-z0-9_.]*$/i;

/**
 * SQL predicate and parameters for a scope. `column` is interpolated, so it must be a
 * fixed identifier from code, never user input; it is validated as a guard.
 */
export function scopeWhere(
  scope: Scope,
  column: string,
  firstParam = 1,
): { sql: string; params: unknown[] } {
  if (!COLUMN_PATTERN.test(column)) throw new Error('invalid scope column');
  if (!Number.isInteger(firstParam) || firstParam < 1) throw new Error('invalid parameter index');
  if (scope.kind === 'all') return { sql: 'TRUE', params: [] };
  return { sql: `${column} = $${firstParam}`, params: [scope.branchId] };
}

export function scopeAllowsBranch(scope: Scope, branchId: string): boolean {
  return scope.kind === 'all' || scope.branchId === branchId;
}
