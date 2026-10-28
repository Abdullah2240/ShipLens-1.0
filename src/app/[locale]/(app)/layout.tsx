import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { appNav, navForRole } from '@/components/shell/nav';
import { getShellSession } from '@/components/shell/shell-session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { role, userSlot } = await getShellSession();

  return (
    <AppShell items={navForRole(appNav, role)} userSlot={userSlot}>
      {children}
    </AppShell>
  );
}
