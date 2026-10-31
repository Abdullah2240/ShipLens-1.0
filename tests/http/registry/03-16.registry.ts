import type { EndpointSpec } from './types';

// Print audit (03-16). Head office only and branchless, so there is no record to cross.
const specs: EndpointSpec[] = [
  {
    id: 'exports.print',
    method: 'POST',
    route: 'exports/print',
    action: 'export.create',
    body: () => ({ kind: 'print_summary', rowCount: 1 }),
  },
];

export default specs;
