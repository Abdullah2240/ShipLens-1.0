import type { EndpointSpec } from './types';

// WhatsApp share (03-12). Branch Lead only, on a report of their own branch; the record key
// generates the cross-branch case (another branch's report is the same 404 as a missing one).
const specs: EndpointSpec[] = [
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
