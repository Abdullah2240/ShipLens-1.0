import type { EndpointSpec } from './types';

// Public impact figures (PUB-05): approved aggregates only, no session needed.
const specs: EndpointSpec[] = [
  { id: 'public.impact', method: 'GET', route: 'public/impact', action: 'public' },
];

export default specs;
