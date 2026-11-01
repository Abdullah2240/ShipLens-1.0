// The five demo logins, defined once. The seed step, docs/test-logins.md and
// scripts/smoke.mjs all read this list so they cannot drift apart. The E2E harness
// pins the same emails, names and roles; change them together or not at all.
//
// Sample data only: invented names and the reserved `.test` domain.

export const DEMO_BRANCH = Object.freeze({
  name: 'Sample Branch (Demo)',
  city: 'Karachi',
  status: 'active',
});

export const DEMO_USERS = Object.freeze([
  Object.freeze({
    key: 'admin',
    email: 'admin@shiplens.test',
    name: 'Amina Khan',
    role: 'super_admin',
    branchScoped: false,
  }),
  Object.freeze({
    key: 'finance',
    email: 'finance@shiplens.test',
    name: 'Bilal Ahmed',
    role: 'finance_reviewer',
    branchScoped: false,
  }),
  Object.freeze({
    key: 'editor',
    email: 'editor@shiplens.test',
    name: 'Sana Malik',
    role: 'content_editor',
    branchScoped: false,
  }),
  Object.freeze({
    key: 'lead',
    email: 'lead@shiplens.test',
    name: 'Omar Siddiqui',
    role: 'branch_lead',
    branchScoped: true,
  }),
  Object.freeze({
    key: 'hr',
    email: 'hr@shiplens.test',
    name: 'Hira Raza',
    role: 'hr_lead',
    branchScoped: true,
  }),
]);
