// Environment validation.
//
// IMPORT-TIME RULE: getEnv() is called only inside request handlers or script entry
// points, never at module top level. `next build` imports every route module with no
// environment, and APP_ORIGIN is required in production, so an import-time call would
// fail the Docker build.
import { z } from 'zod';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

const rawSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().optional(),
  RENDER_EXTERNAL_URL: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SEED_ON_BOOT: z.string().optional(),
  SEED_DEMO_PASSWORD: z.string().optional(),
});

export type Env = {
  DATABASE_URL: string;
  APP_ORIGIN: string;
  NODE_ENV: 'development' | 'test' | 'production';
  LOG_LEVEL: (typeof LOG_LEVELS)[number];
  SEED_ON_BOOT: boolean;
  SEED_DEMO_PASSWORD: string | undefined;
};

/** Thrown for invalid configuration. The message names variables only, never values. */
export class EnvError extends Error {
  readonly variables: string[];
  constructor(variables: string[]) {
    super(`Invalid environment configuration: ${variables.join(', ')}`);
    this.name = 'EnvError';
    this.variables = variables;
  }
}

function blank(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === '' ? undefined : v;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Empty strings count as unset so `FOO=` in a shell or compose file behaves as absent.
  const cleaned: Record<string, string | undefined> = {};
  for (const key of Object.keys(rawSchema.shape)) cleaned[key] = blank(source[key]);

  const parsed = rawSchema.safeParse(cleaned);
  const bad = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) bad.add(String(issue.path[0] ?? 'env'));
  }
  if (!parsed.success) throw new EnvError([...bad]);
  const raw = parsed.data;

  const seedOnBoot = raw.SEED_ON_BOOT === 'true';
  if (seedOnBoot && (raw.SEED_DEMO_PASSWORD ?? '').length < 12) bad.add('SEED_DEMO_PASSWORD');

  let origin = raw.APP_ORIGIN ?? raw.RENDER_EXTERNAL_URL;
  if (origin === undefined && raw.NODE_ENV !== 'production') origin = 'http://localhost:3000';
  if (origin === undefined) {
    bad.add('APP_ORIGIN');
  } else {
    try {
      origin = new URL(origin).origin;
    } catch {
      bad.add('APP_ORIGIN');
    }
  }

  if (bad.size > 0 || origin === undefined) throw new EnvError([...bad]);

  return {
    DATABASE_URL: raw.DATABASE_URL,
    APP_ORIGIN: origin.replace(/\/+$/, ''),
    NODE_ENV: raw.NODE_ENV,
    LOG_LEVEL: raw.LOG_LEVEL,
    SEED_ON_BOOT: seedOnBoot,
    SEED_DEMO_PASSWORD: raw.SEED_DEMO_PASSWORD,
  };
}

let cached: Env | undefined;

/** Parse process.env once and cache. Call only from handlers or script entry points. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: drop the cached value. */
export function resetEnvCache(): void {
  cached = undefined;
}
