'use client';

import { Link, usePathname } from '@/i18n/navigation';

export interface PublicNavLink {
  id: string;
  href: string;
  label: string;
}

/**
 * The public navigation items with the current page marked. The only client part of the
 * public header: it needs the pathname. Links are not prefetched, so a first visit on a
 * phone does not spend its main thread fetching eight pages nobody asked for yet.
 */
export function PublicNavLinks({ items }: { items: PublicNavLink[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex min-w-max items-center gap-1">
      {items.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex h-11 items-center rounded-full px-3.5 text-sm transition-colors md:h-9 ${
                active
                  ? 'bg-accent-soft font-semibold text-text'
                  : 'text-text-muted hover:bg-surface-sunken hover:text-text'
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
