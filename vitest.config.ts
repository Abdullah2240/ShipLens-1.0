import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Naming rule: a test that touches Postgres lives under tests/ or db/, or is named
// *.int.test.*. Every other test is a unit test and must pass with no database running.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['tests/support/setup-dom.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
          exclude: ['**/node_modules/**', '**/*.int.test.*'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'tests/**/*.test.{ts,tsx}',
            'db/**/*.test.{ts,mjs}',
            'src/**/*.int.test.{ts,tsx}',
            'scripts/**/*.int.test.{ts,mjs}',
          ],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
    // Thresholds are wired in Phase 1 and fully enforced in Phase 4.
    // Never lower them to pass; add tests instead.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/modules/**', 'src/platform/**'],
      exclude: ['**/*.test.*', '**/*.d.ts', '**/index.ts'],
      thresholds: { lines: 60, statements: 60, functions: 60, branches: 50 },
    },
  },
});
