import type { EndpointSpec } from './types';

// Audit chain status (04-03). Head office only; no branch record to cross.
const specs: EndpointSpec[] = [
  { id: 'audit.chain', method: 'GET', route: 'audit/chain', action: 'audit.read_finance' },
];

export default specs;
