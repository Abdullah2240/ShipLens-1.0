import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LogoutButton } from '@/modules/auth/ui/LogoutButton';
import type { Role } from '@/platform/authz/roles';
import { getCurrentActor } from '@/platform/http/server';

export interface ShellSession {
  role: Role | null;
  userSlot: ReactNode;
}

// Seam between the app layout and authentication. Signed in, the nav is filtered by the
// actor's role and the slot shows the user's name, role and a logout button; signed out,
// the shell renders with an empty nav and no slot. Page-level login enforcement stays in
// each page (requireActor); the shell never redirects.
export async function getShellSession(): Promise<ShellSession> {
  const current = await getCurrentActor();
  if (!current) return { role: null, userSlot: null };

  const { actor, user } = current;
  const t = await getTranslations('auth');

  return {
    role: actor.role,
    userSlot: (
      <div className="flex items-center gap-3 border-s border-border ps-3">
        <div className="hidden min-w-0 flex-col text-end leading-tight sm:flex">
          <span className="max-w-44 truncate text-sm font-semibold text-text">{user.name}</span>
          <span className="truncate text-xs text-text-muted">{t(`roles.${actor.role}`)}</span>
        </div>
        <LogoutButton variant="compact" />
      </div>
    ),
  };
}
