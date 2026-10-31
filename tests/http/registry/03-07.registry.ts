import type { EndpointSpec } from './types';

// CSV exports (03-07). One route serves the four kinds; the matrix calls the summary kind.
// Head office only, so there is no branch record to cross.
const specs: EndpointSpec[] = [
  {
    id: 'exports.csv',
    method: 'GET',
    route: 'exports/[kind]',
    action: 'export.create',
    params: () => ({ kind: 'summary' }),
  },
];

export default specs;
