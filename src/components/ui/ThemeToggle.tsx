'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

export type ThemeChoice = 'system' | 'light' | 'dark';

const CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function currentTheme(): ThemeChoice {
  const value = document.documentElement.dataset.theme;
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  document.cookie = `theme=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

const ICONS: Record<ThemeChoice, string> = {
  system: 'M4 5h16v10H4zM9 19h6M12 15v4',
  light:
    'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  dark: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
};

export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('common.theme');
  const active = useSyncExternalStore(subscribe, currentTheme, () => 'system' as ThemeChoice);

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={`inline-flex gap-0.5 rounded-full border border-border bg-surface-sunken p-0.5 ${className}`}
    >
      {CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={active === choice}
          aria-label={t(choice)}
          title={t(choice)}
          onClick={() => applyTheme(choice)}
          className="grid size-8 place-items-center rounded-full text-text-muted transition-colors hover:text-text aria-pressed:bg-primary aria-pressed:text-primary-contrast"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={ICONS[choice]} />
          </svg>
        </button>
      ))}
    </div>
  );
}
