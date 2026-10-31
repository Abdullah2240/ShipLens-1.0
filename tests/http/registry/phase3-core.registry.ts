import type { EndpointSpec } from './types';

// Phase 3 core endpoints: head office dashboard (03-01) and routing to the main account
// (03-02). Actions are copied from each route file; the registry test fails when they drift.
const specs: EndpointSpec[] = [
  // Dashboard
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

  // Routing
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
];

export default specs;
