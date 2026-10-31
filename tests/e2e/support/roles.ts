// The five demo users seeded by db/seed (seed contract: email, role, display name).
// A drift between this map and the seed fails loginAs() loudly instead of skipping.
export type Role =
  'super_admin' | 'finance_reviewer' | 'content_editor' | 'branch_lead' | 'hr_lead';

export const ROLES_E2E: Readonly<Record<Role, { email: string; name: string }>> = Object.freeze({
  super_admin: { email: 'admin@shiplens.test', name: 'Amina Khan' },
  finance_reviewer: { email: 'finance@shiplens.test', name: 'Bilal Ahmed' },
  content_editor: { email: 'editor@shiplens.test', name: 'Sana Malik' },
  branch_lead: { email: 'lead@shiplens.test', name: 'Omar Siddiqui' },
  hr_lead: { email: 'hr@shiplens.test', name: 'Hira Raza' },
});

export const DEMO_BRANCH_NAME = 'Sample Branch (Demo)';

/** The seed password of the stack under test. Never logged or attached to reports. */
export function demoPassword(): string {
  const value = process.env.E2E_DEMO_PASSWORD;
  if (!value) {
    throw new Error(
      'E2E_DEMO_PASSWORD is not set: export the seed password of the stack under test',
    );
  }
  return value;
}
