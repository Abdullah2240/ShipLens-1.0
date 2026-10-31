import type { EndpointSpec } from './types';

// Audit viewer endpoints (AUD-05). Super Admin sees every entity type, Finance Reviewer only
// finance entity types; the route admits both through audit.read_finance.
const specs: EndpointSpec[] = [
  { id: 'audit.list', method: 'GET', route: 'audit', action: 'audit.read_finance' },
  { id: 'audit.facets', method: 'GET', route: 'audit/facets', action: 'audit.read_finance' },
];

export default specs;
