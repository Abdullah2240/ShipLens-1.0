import type { EndpointSpec } from './types';

// Report verification (04-05). The public check takes the code issued for the world's
// approved report; the authorised lookup is a branch-scoped read of that report.
const specs: EndpointSpec[] = [
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
