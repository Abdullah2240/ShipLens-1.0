import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The first lintText call loads the whole Next config; give it room.
const eslint = new ESLint({ cwd: process.cwd() });

async function messagesFor(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

describe('layer rules (no-restricted-imports)', { timeout: 180_000 }, () => {
  it('rejects next/* imports in a repo file', async () => {
    const found = await messagesFor(
      "import { headers } from 'next/headers';\nexport const x = headers;\n",
      'src/modules/branches/repo.ts',
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects next/* imports in a service file', async () => {
    const found = await messagesFor(
      "import { cookies } from 'next/headers';\nexport const x = cookies;\n",
      'src/modules/branches/service.ts',
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects next/* imports in kernel code', async () => {
    const found = await messagesFor(
      "import { cookies } from 'next/headers';\nexport const x = cookies;\n",
      'src/platform/authz/authorize.ts',
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects app code importing a repository', async () => {
    const found = await messagesFor(
      "import { list } from '@/modules/branches/repo';\nexport const x = list;\n",
      'src/app/[locale]/page.tsx',
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects a repo importing the audit writer', async () => {
    const found = await messagesFor(
      "import { writeAudit } from '@/platform/audit';\nexport const x = writeAudit;\n",
      'src/modules/branches/repo.ts',
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('allows app code to import a service', async () => {
    const found = await messagesFor(
      "import { list } from '@/modules/branches/service';\nexport const x = list;\n",
      'src/app/[locale]/page.tsx',
    );
    expect(found).toHaveLength(0);
  });
});
