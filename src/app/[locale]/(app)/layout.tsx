import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { AppShell } from '@/components/shell/AppShell';
import { appNav, navForRole } from '@/components/shell/nav';
import { getShellSession } from '@/components/shell/shell-session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { role, userSlot } = await getShellSession();

  // Every namespace for the signed-in screens' client components (the root layout sends
  // only the shell's strings).
  return (
    <NextIntlClientProvider>
      <AppShell items={navForRole(appNav, role)} userSlot={userSlot}>
        {children}
      </AppShell>
    </NextIntlClientProvider>
  );
}
