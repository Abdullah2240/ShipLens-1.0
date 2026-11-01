/** Audit action codes written by the finance and branch workflows (and labelled for display). */
export const OWNER_AUDIT_ACTIONS: readonly string[] = Object.freeze([
  'branch.create',
  'branch.update',
  'branch.transition',
  'branch.assign_lead',
  'report.create_draft',
  'report.submit',
  'report.resubmit',
  'report.return',
  'report.approve',
  'report.share',
  'collection.create',
  'collection.amend',
  'collection.amend_exempt',
  'collection.void',
  'collection.void_exempt',
  'collection.mark_routed',
  'collection.unmark_routed',
  'export.create',
  'seed.created',
]);

/** Message key under `audit.actions` for an action code: dots become underscores. */
export function actionMessageKey(action: string): string {
  return action.replaceAll('.', '_');
}
