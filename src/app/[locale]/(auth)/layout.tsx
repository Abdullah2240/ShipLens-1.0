import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { MinimalShell } from '@/components/shell/MinimalShell';

// Sign-in pages sit inside the minimal shell so the language switch and theme toggle
// are present without the page itself rendering them. Every namespace is provided to the
// sign-in forms (the root layout sends only the shell's strings).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider>
      <MinimalShell>{children}</MinimalShell>
    </NextIntlClientProvider>
  );
}
