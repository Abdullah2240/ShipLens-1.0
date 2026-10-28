import type { ReactNode } from 'react';
import { nastaliqClassName } from '@/app/fonts';
import { PublicShell } from '@/components/shell/PublicShell';

// The Nastaliq display face is provided here only; it applies to elements using
// `font-display-ur` under lang="ur". App and sign-in layouts never load it.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className={nastaliqClassName}>
      <PublicShell>{children}</PublicShell>
    </div>
  );
}
