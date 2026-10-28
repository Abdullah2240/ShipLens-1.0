import type { ReactNode } from 'react';
import { MinimalShell } from '@/components/shell/MinimalShell';

// Sign-in pages sit inside the minimal shell so the language switch and theme toggle
// are present without the page itself rendering them.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <MinimalShell>{children}</MinimalShell>;
}
