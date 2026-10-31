// Loads the demo dataset into the lane test database through the real seed runner
// (steps 01 and 02), exactly as a first boot with SEED_ON_BOOT does.
import { runSeed } from '../../db/seed/index.mjs';
import { getTestDatabaseUrl, resetDb, testPool } from '../support/db';

/** A throwaway value for the test database only; it protects nothing. */
export const RECONCILE_SEED_ENV = Object.freeze({
  SEED_DEMO_PASSWORD: 'reconcile-only-password-1',
  SEED_ON_BOOT: 'true',
});

/** Runs the seed runner once against the lane database, without clearing it first. */
export async function runDemoSeed(): Promise<void> {
  await runSeed({
    connectionString: getTestDatabaseUrl(),
    env: { ...RECONCILE_SEED_ENV },
    log: () => {},
  });
}

/** Empties the lane database and loads the demo dataset. Same rows every time. */
export async function seedDemoDatabase(): Promise<void> {
  await resetDb(testPool());
  await runDemoSeed();
}
