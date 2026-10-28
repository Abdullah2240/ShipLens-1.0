// Fields that may appear in audit before/after snapshots, per entity type.
// Add a field here deliberately: adding a sensitive field (secrets, contact details,
// free text) is a review blocker. Entity types not listed here are rejected.
export const AUDIT_FIELD_ALLOWLIST: Record<string, readonly string[]> = {
  user: ['role', 'branch_id', 'is_active', 'name'],
  // login and logout events carry the action and ids only
  session: [],
  branch: ['code', 'name', 'city', 'status', 'summary'],
  collection: [
    'amount',
    'collected_on',
    'purpose',
    'status',
    'void_reason',
    'routed_at',
    'report_id',
  ],
  report: ['status', 'total_amount', 'collection_count', 'return_reason', 'week_start', 'version'],
  // never name, email, phone or message: applicant contact details are sensitive
  application: ['status', 'branch_id', 'decision_note'],
  member: ['member_code', 'branch_id', 'team_id', 'member_role', 'status'],
  team: ['name', 'branch_id'],
  // never the full body
  content: ['key', 'locale', 'status', 'title'],
  event: ['slug', 'status', 'starts_at', 'location', 'branch_id'],
  export: ['kind', 'row_count'],
  share: ['channel'],
};
