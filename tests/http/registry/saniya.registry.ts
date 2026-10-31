import type { EndpointSpec, World } from './types';

let teamSeq = 0;
let applicantSeq = 0;

const entry = () => ({ key: 'about', locale: 'en' });

// Saniya-track endpoints: members and teams (02-05), applications and review (02-07,
// 02-08), content entries (02-10) and events (02-13). Actions are copied from each route
// file; the registry test fails when they drift.
const specs: EndpointSpec[] = [
  // Members and teams
  {
    id: 'members.list',
    method: 'GET',
    route: 'members',
    action: 'member.read',
    listOf: 'branchId',
  },
  {
    id: 'members.get',
    method: 'GET',
    route: 'members/[id]',
    action: 'member.read',
    record: 'member',
  },
  {
    id: 'members.update',
    method: 'PATCH',
    route: 'members/[id]',
    action: 'member.update',
    record: 'member',
    body: () => ({ status: 'inactive' }),
  },
  {
    id: 'teams.list',
    method: 'GET',
    route: 'teams',
    action: 'team.read',
    listOf: 'branchId',
    branchFilter: true,
  },
  {
    id: 'teams.create',
    method: 'POST',
    route: 'teams',
    action: 'team.manage',
    // Head-office roles must name the branch; a branch role may name only its own.
    body: (w: World) => ({ name: `Matrix Team ${++teamSeq}`, branchId: w.branchA }),
    createsIn: 'session-branch',
    createsTable: 'teams',
  },
  {
    id: 'teams.rename',
    method: 'PATCH',
    route: 'teams/[id]',
    action: 'team.manage',
    record: 'team',
    body: () => ({ name: `Matrix Renamed ${++teamSeq}` }),
  },

  // Applications
  {
    id: 'applications.list',
    method: 'GET',
    route: 'applications',
    action: 'application.read',
    listOf: 'branchId',
  },
  {
    id: 'applications.get',
    method: 'GET',
    route: 'applications/[id]',
    action: 'application.read',
    record: 'application',
  },
  {
    id: 'applications.accept',
    method: 'POST',
    route: 'applications/[id]/accept',
    action: 'application.decide',
    record: 'application',
  },
  {
    id: 'applications.decline',
    method: 'POST',
    route: 'applications/[id]/decline',
    action: 'application.decide',
    record: 'application',
    body: () => ({ note: 'Matrix decline' }),
  },
  {
    id: 'public.applications.submit',
    method: 'POST',
    route: 'public/applications',
    action: 'public',
    body: (w) => ({
      fullName: 'Matrix Applicant',
      email: `matrix.applicant.${++applicantSeq}@example.test`,
      branchId: w.branchA,
    }),
  },

  // Content entries
  { id: 'content.entries.list', method: 'GET', route: 'content/entries', action: 'content.read' },
  {
    id: 'content.entries.get',
    method: 'GET',
    route: 'content/entries/[key]/[locale]',
    action: 'content.read',
    params: entry,
  },
  {
    id: 'content.entries.save_draft',
    method: 'PUT',
    route: 'content/entries/[key]/[locale]',
    action: 'content.edit',
    params: entry,
    body: () => ({ title: 'Matrix title', body: 'Matrix body' }),
  },
  {
    id: 'content.entries.publish',
    method: 'POST',
    route: 'content/entries/[key]/[locale]/publish',
    action: 'content.publish',
    params: entry,
  },
  {
    id: 'content.entries.unpublish',
    method: 'POST',
    route: 'content/entries/[key]/[locale]/unpublish',
    action: 'content.unpublish',
    params: entry,
  },
  {
    id: 'content.entries.preview',
    method: 'GET',
    route: 'content/entries/[key]/[locale]/preview',
    action: 'content.preview',
    params: entry,
  },

  // Events
  { id: 'content.events.list', method: 'GET', route: 'content/events', action: 'content.read' },
  {
    id: 'content.events.create',
    method: 'POST',
    route: 'content/events',
    action: 'content.edit',
    body: () => ({ titleEn: 'Matrix event' }),
  },
  {
    id: 'content.events.get',
    method: 'GET',
    route: 'content/events/[id]',
    action: 'content.read',
    record: 'event',
  },
  {
    id: 'content.events.update',
    method: 'PATCH',
    route: 'content/events/[id]',
    action: 'content.edit',
    record: 'event',
    body: () => ({ titleEn: 'Matrix event renamed' }),
  },
  {
    id: 'content.events.publish',
    method: 'POST',
    route: 'content/events/[id]/publish',
    action: 'content.publish',
    record: 'event',
  },
  {
    id: 'content.events.unpublish',
    method: 'POST',
    route: 'content/events/[id]/unpublish',
    action: 'content.unpublish',
    record: 'event',
  },
];

export default specs;
