import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { dirFor } from '@/i18n/routing';

export type RenderIntlOptions = {
  locale?: 'en' | 'ur';
  namespaces?: string[];
};

const MESSAGES_ROOT = path.resolve(import.meta.dirname, '../../messages');

function loadNamespace(locale: string, ns: string): Record<string, unknown> {
  const file = path.join(MESSAGES_ROOT, locale, `${ns}.json`);
  if (!existsSync(file)) {
    throw new Error(`renderWithIntl: unknown namespace "${ns}" (no messages/${locale}/${ns}.json)`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

// Same message shape as src/i18n/request.ts: { [namespace]: contents }.
export function renderWithIntl(
  ui: ReactElement,
  { locale = 'en', namespaces = ['common'] }: RenderIntlOptions = {},
): RenderResult {
  const messages = Object.fromEntries(namespaces.map((ns) => [ns, loadNamespace(locale, ns)]));
  const result = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
  result.container.setAttribute('lang', locale);
  result.container.setAttribute('dir', dirFor(locale));
  return result;
}
