import type { EndpointSpec } from './types';

let branchSeq = 0;

// Owner-track endpoints: branches (02-19), collections (02-21), reports (02-22), timelines
// (02-20), plus the Phase 1 auth endpoints. Actions are copied from each route file; the
// registry test fails when they drift.
const specs: EndpointSpec[] = [
  // Branches
  { id: 'branches.list', method: 'GET', route: 'branches', action: 'branch.read', listOf: 'id' },
  {
    id: 'branches.create',
    method: 'POST',
    route: 'branches',
    action: 'branch.create',
    body: () => ({ name: `Matrix Branch ${++branchSeq}` }),
  },
  {
    id: 'branches.get',
    method: 'GET',
    route: 'branches/[id]',
    action: 'branch.read',
    record: 'branch',
  },
  {
    id: 'branches.update',
    method: 'PATCH',
    route: 'branches/[id]',
    action: 'branch.update',
    record: 'branch',
    body: () => ({ summary: 'Matrix summary' }),
  },
  {
    id: 'branches.transition',
    method: 'POST',
    route: 'branches/[id]/status',
    action: 'branch.transition',
    record: 'branch',
    body: () => ({ to: 'paused' }),
  },
  {
    id: 'branches.assign_lead',
    method: 'POST',
    route: 'branches/[id]/leads',
    action: 'branch.assign_leads',
    record: 'branch',
    body: (w) => ({ userId: w.users.hr_lead_b.id }),
  },
  {
    id: 'branches.lead_candidates',
    method: 'GET',
    route: 'branches/lead-candidates',
    action: 'user.read',
  },

  // Collections
  {
    id: 'collections.list',
    method: 'GET',
    route: 'collections',
    action: 'collection.read',
    listOf: 'branchId',
    branchFilter: true,
  },
  {
    id: 'collections.create',
    method: 'POST',
    route: 'collections',
    action: 'collection.create',
    body: (w) => ({ amount: '100.00', collectedOn: w.today, purpose: 'Matrix test' }),
    createsIn: 'session-branch',
    createsTable: 'collections',
  },
  {
    id: 'collections.current_week',
    method: 'GET',
    route: 'collections/current-week',
    action: 'collection.create',
  },
  {
    id: 'collections.get',
    method: 'GET',
    route: 'collections/[id]',
    action: 'collection.read',
    record: 'collection',
  },
  {
    id: 'collections.amend',
    method: 'PATCH',
    route: 'collections/[id]',
    action: 'collection.amend',
    record: 'collection',
    body: () => ({ purpose: 'Matrix amend' }),
  },
  {
    id: 'collections.void',
    method: 'POST',
    route: 'collections/[id]/void',
    action: 'collection.void',
    record: 'collection',
    body: () => ({ reason: 'Matrix void' }),
  },
  {
    id: 'collections.timeline',
    method: 'GET',
    route: 'collections/[id]/timeline',
    action: 'audit.read_timeline',
    record: 'collection',
  },

  // Reports
  {
    id: 'reports.list',
    method: 'GET',
    route: 'reports',
    action: 'report.read',
    listOf: 'branchId',
    branchFilter: true,
  },
  {
    id: 'reports.review_queue',
    method: 'GET',
    route: 'reports/review-queue',
    action: 'report.approve',
    listOf: 'branchId',
  },
  {
    id: 'reports.get',
    method: 'GET',
    route: 'reports/[id]',
    action: 'report.read',
    record: 'report_submitted',
  },
  {
    id: 'reports.submit',
    method: 'POST',
    route: 'reports/[id]/submit',
    action: 'report.submit',
    record: 'report_draft',
    body: () => ({ confirmNil: true }),
  },
  {
    id: 'reports.return',
    method: 'POST',
    route: 'reports/[id]/return',
    action: 'report.return',
    record: 'report_submitted',
    body: () => ({ reason: 'Matrix return' }),
  },
  {
    id: 'reports.approve',
    method: 'POST',
    route: 'reports/[id]/approve',
    action: 'report.approve',
    record: 'report_submitted',
    body: () => ({}),
  },
  {
    id: 'reports.timeline',
    method: 'GET',
    route: 'reports/[id]/timeline',
    action: 'audit.read_timeline',
    record: 'report_draft',
  },

  // Auth (Phase 1)
  {
    id: 'auth.login',
    method: 'POST',
    route: 'auth/login',
    action: 'public',
    body: (w) => ({ email: w.login.email, password: w.login.password }),
  },
  { id: 'auth.logout', method: 'POST', route: 'auth/logout', action: 'session' },
  { id: 'auth.me', method: 'GET', route: 'auth/me', action: 'session' },
];

export default specs;
