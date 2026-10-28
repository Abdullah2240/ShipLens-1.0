export const ROLES = [
  'super_admin',
  'finance_reviewer',
  'content_editor',
  'branch_lead',
  'hr_lead',
] as const;
export type Role = (typeof ROLES)[number];
export const BRANCH_SCOPED_ROLES = ['branch_lead', 'hr_lead'] as const;
