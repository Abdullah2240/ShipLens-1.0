import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const FRAMEWORK_PATTERNS = ['next', 'next/*', 'next-intl', 'next-intl/*', 'react', 'react-dom'];
const FRAMEWORK_MESSAGE = 'Services, repositories and kernel code must not import framework code';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts', 'out/**']),
  {
    // Services and kernel code stay framework-free.
    files: [
      'src/modules/**/service*.ts',
      'src/modules/**/repo*.ts',
      'src/platform/{authz,audit,db,time,money,errors,config,log}/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: FRAMEWORK_PATTERNS, message: FRAMEWORK_MESSAGE }] },
      ],
    },
  },
  {
    // Pages and routes go through services, never repositories.
    files: ['src/app/**', 'src/components/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/repo*', '**/repo'],
              message: 'Pages and routes go through services, never repositories',
            },
          ],
        },
      ],
    },
  },
  {
    // Repos: no other module's repo, no audit writes (command() does that).
    // This block replaces the first one for the same files, so the framework
    // patterns are repeated here.
    files: ['src/modules/**/repo*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: FRAMEWORK_PATTERNS, message: FRAMEWORK_MESSAGE },
            {
              group: ['@/modules/*'],
              message: 'Repositories must not import other modules',
            },
            {
              group: ['@/platform/audit', '@/platform/audit/*'],
              message: 'Repositories never write audit rows; command() does',
            },
          ],
        },
      ],
    },
  },
]);
