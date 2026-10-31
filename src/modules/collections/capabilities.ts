// What a role may do on the collection screens, read from the permission table.
// Pure and client-safe: no server imports.
import { PERMISSIONS, type Action } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';
import type { CollectionEditability } from './lock';

export interface CollectionCapabilities {
  canLog: boolean;
  canAmend: boolean;
  canVoid: boolean;
  canSeeAll: boolean;
  canSeeTimeline: boolean;
}

function granted(action: Action, role: Role): boolean {
  return Object.hasOwn(PERMISSIONS[action], role);
}

export function collectionCapabilities(role: Role): CollectionCapabilities {
  const read: Partial<Record<Role, string>> = PERMISSIONS['collection.read'];
  return {
    canLog: granted('collection.create', role),
    canAmend: granted('collection.amend', role),
    canVoid: granted('collection.void', role),
    canSeeAll: read[role] === 'all',
    canSeeTimeline: granted('audit.read_timeline', role),
  };
}

/** True when the server says the collection may still be amended or voided. */
export function isEditable(editability: CollectionEditability): boolean {
  return editability === 'editable' || editability === 'editable_exempt';
}
