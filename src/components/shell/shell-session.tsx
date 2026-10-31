import type { ReactNode } from 'react';
import type { Role } from '@/platform/authz/roles';

export interface ShellSession {
  role: Role | null;
  userSlot: ReactNode;
}

// Seam between the app layout and authentication. Until the auth plan lands there is no
// signed-in actor, so the shell renders with an empty nav and no account slot. The auth
// plan replaces this body with a lookup of the current actor and renders the account and
// logout controls in `userSlot`. Page-level login enforcement stays in each page; the
// shell never redirects.
export async function getShellSession(): Promise<ShellSession> {
  return { role: null, userSlot: null };
}
