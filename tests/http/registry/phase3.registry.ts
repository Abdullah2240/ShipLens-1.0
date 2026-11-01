import type { EndpointSpec, Side, World } from './types';

// Every Phase 3 endpoint for the generated role x action matrix and the cross-branch suite.
// Actions are copied from each route file; the registry test fails when they drift.
// Dashboard, trace, export and audit endpoints are head office only (no branch role holds
// their action), so they generate 403 cases for Branch Lead, HR Lead and Content Editor and
// no cross-branch case; share is the one branch-scoped record endpoint.

// Trace params walk the approved figure down the world's approved report and its unrouted
// collection on each side. A record under another branch's path is a proof-chain 404, not
// a scope check.
const SLUG = 'approved';
const branchPath = (w: World, side: Side) => ({ slug: SLUG, branchId: w.records.branch![side] });
const reportPath = (w: World, side: Side) => ({
  ...branchPath(w, side),
  reportId: w.records.report_approved![side],
});

const specs: EndpointSpec[] = [
  // Head office dashboard (03-01)
  {
    id: 'dashboard.summary',
    method: 'GET',
    route: 'dashboard/summary',
    action: 'dashboard.read',
  },
  { id: 'dashboard.trend', method: 'GET', route: 'dashboard/trend', action: 'dashboard.read' },
  {
    id: 'dashboard.unrouted',
    method: 'GET',
    route: 'dashboard/unrouted',
    action: 'dashboard.read',
  },
  { id: 'dashboard.routed', method: 'GET', route: 'dashboard/routed', action: 'dashboard.read' },

  // Routing to the main account (03-02)
  {
    id: 'collections.mark_routed',
    method: 'POST',
    route: 'collections/[id]/routed',
    action: 'collection.mark_routed',
    record: 'collection_approved',
  },
  {
    id: 'collections.unmark_routed',
    method: 'DELETE',
    route: 'collections/[id]/routed',
    action: 'collection.unmark_routed',
    record: 'collection_routed',
  },

  // Audit viewer (03-05): Super Admin sees every entity type, Finance Reviewer only finance
  // entity types; the route admits both through audit.read_finance.
  { id: 'audit.list', method: 'GET', route: 'audit', action: 'audit.read_finance' },
  { id: 'audit.facets', method: 'GET', route: 'audit/facets', action: 'audit.read_finance' },

  // Figure drill-down L1 to L4 (03-06)
  {
    id: 'trace.figure',
    method: 'GET',
    route: 'trace/[slug]',
    action: 'trace.read',
    params: () => ({ slug: SLUG }),
  },
  {
    id: 'trace.branch',
    method: 'GET',
    route: 'trace/[slug]/branches/[branchId]',
    action: 'trace.read',
    params: branchPath,
  },
  {
    id: 'trace.report',
    method: 'GET',
    route: 'trace/[slug]/branches/[branchId]/reports/[reportId]',
    action: 'trace.read',
    params: reportPath,
  },
  {
    id: 'trace.collection',
    method: 'GET',
    route: 'trace/[slug]/branches/[branchId]/reports/[reportId]/collections/[collectionId]',
    action: 'trace.read',
    params: (w, side) => ({
      ...reportPath(w, side),
      collectionId: w.records.collection_approved![side],
    }),
  },

  // CSV exports (03-07): one route serves the four kinds; the matrix calls the summary kind.
  {
    id: 'exports.csv',
    method: 'GET',
    route: 'exports/[kind]',
    action: 'export.create',
    params: () => ({ kind: 'summary' }),
  },

  // Print audit (03-16)
  {
    id: 'exports.print',
    method: 'POST',
    route: 'exports/print',
    action: 'export.create',
    body: () => ({ kind: 'print_summary', rowCount: 1 }),
  },

  // Public impact figures (03-11): approved aggregates only, no session needed.
  { id: 'public.impact', method: 'GET', route: 'public/impact', action: 'public' },

  // WhatsApp share (03-12): Branch Lead only, on a report of their own branch; the record key
  // generates the cross-branch case (another branch's report is the same 404 as a missing one).
  {
    id: 'reports.share',
    method: 'POST',
    route: 'reports/[id]/share',
    action: 'report.share',
    record: 'report_submitted',
    body: () => ({ locale: 'en' }),
  },
];

export default specs;
