import type { EndpointSpec, Side, World } from './types';

// Figure drill-down (03-06). Head office only (trace.read), so no branch role can hold
// these and the cross-branch suite has nothing to generate; a record under another
// branch's path is a proof-chain 404, not a scope check. The params walk the approved
// figure down the world's approved report and its unrouted collection on each side.
const SLUG = 'approved';
const branchPath = (w: World, side: Side) => ({ slug: SLUG, branchId: w.records.branch![side] });
const reportPath = (w: World, side: Side) => ({
  ...branchPath(w, side),
  reportId: w.records.report_approved![side],
});

const specs: EndpointSpec[] = [
  {
    id: 'trace.figure',
    method: 'GET',
    route: 'trace/[slug]',
    action: 'trace.read',
    params: () => ({ slug: SLUG }),
  },
  {
    id: 'trace.branch',
    method: 'GET',
    route: 'trace/[slug]/branches/[branchId]',
    action: 'trace.read',
    params: branchPath,
  },
  {
    id: 'trace.report',
    method: 'GET',
    route: 'trace/[slug]/branches/[branchId]/reports/[reportId]',
    action: 'trace.read',
    params: reportPath,
  },
  {
    id: 'trace.collection',
    method: 'GET',
    route: 'trace/[slug]/branches/[branchId]/reports/[reportId]/collections/[collectionId]',
    action: 'trace.read',
    params: (w, side) => ({
      ...reportPath(w, side),
      collectionId: w.records.collection_approved![side],
    }),
  },
];

export default specs;
