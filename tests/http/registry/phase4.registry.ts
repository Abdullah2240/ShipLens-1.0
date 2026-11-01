import type { EndpointSpec } from './types';

// Every Phase 4 endpoint for the generated role x action matrix and the cross-branch suite:
// the three "Proof, not promises" routes. Actions are copied from each route file; the
// registry test fails when they drift.
const specs: EndpointSpec[] = [
  // Audit chain status (04-03). Head office only; no branch record to cross.
  { id: 'audit.chain', method: 'GET', route: 'audit/chain', action: 'audit.read_finance' },

  // Report verification (04-05). The public check takes the code issued for the world's
  // approved report; the authorised lookup is a branch-scoped read of that report.
  {
    id: 'public.verify',
    method: 'GET',
    route: 'public/verify/[code]',
    action: 'public',
    params: (w, side) => ({ code: w.verificationCodes[side] }),
  },
  {
    id: 'reports.verification',
    method: 'GET',
    route: 'reports/[id]/verification',
    action: 'report.read',
    record: 'report_approved',
  },
];

export default specs;
