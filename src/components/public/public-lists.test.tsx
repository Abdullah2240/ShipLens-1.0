// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicBranch, PublicEvent } from '@/modules/public-site';
import { formatDateTime } from '@/platform/i18n/format';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { BranchesByCity } from './BranchesByCity';
import { EventList } from './EventList';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NAMESPACES = ['common', 'shell', 'public'];
const LOCALES = ['en', 'ur'] as const;
const PHYSICAL =
  /(^|\s)(ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)(-|\s|$)/;

type ListMessages = {
  branches: { otherCity: string; applyHere: string; empty: { title: string; body: string } };
  events: {
    where: string;
    hostedBy: string;
    fallbackNote: string;
    empty: { title: string; body: string };
  };
};

function messages(locale: 'en' | 'ur'): ListMessages {
  const file = path.resolve(import.meta.dirname, `../../../messages/${locale}/public.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as ListMessages;
}

function expectNoPhysicalClasses(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const className = el.getAttribute('class') ?? '';
    expect(className, `<${el.tagName.toLowerCase()} class="${className}">`).not.toMatch(PHYSICAL);
  }
}

const BRANCHES: PublicBranch[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Gulberg',
    city: 'Lahore',
    summary: 'Weekend tutoring and a monthly health camp.',
  },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Model Town', city: 'Lahore', summary: null },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Clifton',
    city: 'Karachi',
    summary: 'Relief drives.',
  },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Roaming team', city: null, summary: null },
];

const EVENT: PublicEvent = {
  slug: 'health-camp',
  title: 'Free health camp',
  summary: 'Bring your family.\nCheck-ups from 10am.',
  location: 'Community hall, Gulberg',
  // 10:00 to 13:00 in Pakistan time (UTC+5).
  startsAt: '2026-11-07T05:00:00.000Z',
  endsAt: '2026-11-07T08:00:00.000Z',
  branchName: 'Gulberg',
  locale: 'en',
};

describe('BranchesByCity', () => {
  it('groups branches under one heading per city with branches without a city last', () => {
    const { container } = renderWithIntl(<BranchesByCity branches={BRANCHES} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    const cities = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(cities).toEqual(['Lahore', 'Karachi', messages('en').branches.otherCity]);

    const lahore = container.querySelector('h2')?.closest('section');
    expect(lahore).not.toBeNull();
    const names = Array.from(lahore!.querySelectorAll('h3')).map((h) => h.textContent);
    expect(names).toEqual(['Gulberg', 'Model Town']);
  });

  it('shows the name and the summary when present, and links each card to the application form', () => {
    const { container } = renderWithIntl(<BranchesByCity branches={BRANCHES} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    expect(screen.getByText('Weekend tutoring and a monthly health camp.')).toBeInTheDocument();
    const card = Array.from(container.querySelectorAll('h3'))
      .find((h) => h.textContent === 'Model Town')
      ?.closest('li');
    expect(card).toBeTruthy();
    expect(card!.querySelectorAll('p')).toHaveLength(0);

    const links = Array.from(container.querySelectorAll('section li a'));
    expect(links.map((link) => link.textContent)).toEqual(
      BRANCHES.map(() => expect.stringContaining(messages('en').branches.applyHere)),
    );
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      BRANCHES.map((branch) => `/get-involved/apply?branch=${branch.id}`),
    );
  });

  it('renders only public fields even when a row carries more', () => {
    const leaky = [
      { ...BRANCHES[0], code: 'LHR-SECRET-01', status: 'paused-secret' } as unknown as PublicBranch,
    ];
    const { container } = renderWithIntl(<BranchesByCity branches={leaky} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    expect(container.textContent).not.toContain('LHR-SECRET-01');
    expect(container.textContent).not.toContain('paused-secret');
    expect(container.innerHTML).not.toContain('LHR-SECRET-01');
  });

  it.each(LOCALES)('shows a friendly empty state in %s', (locale) => {
    const copy = messages(locale).branches.empty;
    renderWithIntl(<BranchesByCity branches={[]} locale={locale} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const status = screen.getByRole('status', { hidden: true });
    expect(status).toHaveTextContent(copy.title);
    expect(status).toHaveTextContent(copy.body);
  });

  it.each(LOCALES)('reads in %s with the right direction and only logical classes', (locale) => {
    const { container } = renderWithIntl(<BranchesByCity branches={BRANCHES} locale={locale} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('lang', locale);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(Array.from(container.querySelectorAll('h2')).at(-1)).toHaveTextContent(
      messages(locale).branches.otherCity,
    );
    expectNoPhysicalClasses(container);
  });
});

describe('EventList', () => {
  it('renders an ordered list with title, start time, same-day end time, venue, host and summary', () => {
    const { container } = renderWithIntl(<EventList events={[EVENT]} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    const list = container.querySelector('ol');
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll(':scope > li');
    expect(items).toHaveLength(1);
    const item = items[0] as HTMLElement;
    expect(item.querySelector('h3')).toHaveTextContent('Free health camp');

    const times = item.querySelectorAll('time');
    expect(times[0]).toHaveAttribute('datetime', EVENT.startsAt);
    expect(times[0]).toHaveTextContent(formatDateTime(new Date(EVENT.startsAt), 'en'));
    expect(times[0]).toHaveTextContent('10:00');
    expect(times[1]).toHaveAttribute('datetime', EVENT.endsAt);
    expect(times[1]?.textContent).toBe('13:00');
    expect(item).toHaveTextContent('until 13:00');

    const copy = messages('en').events;
    expect(within(item).getByText(copy.where)).toBeInTheDocument();
    expect(item).toHaveTextContent('Community hall, Gulberg');
    expect(within(item).getByText(copy.hostedBy)).toBeInTheDocument();
    expect(item).toHaveTextContent('Gulberg');

    const summary = within(item).getByText(/Bring your family\./);
    expect(summary).toHaveClass('whitespace-pre-line');
    expect(summary.textContent).toBe('Bring your family.\nCheck-ups from 10am.');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows the full end date and time when the event ends on another day', () => {
    const multiDay = { ...EVENT, endsAt: '2026-11-08T12:30:00.000Z' };
    const { container } = renderWithIntl(<EventList events={[multiDay]} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    const end = container.querySelectorAll('time')[1];
    expect(end).toHaveAttribute('datetime', multiDay.endsAt);
    expect(end?.textContent).toBe(formatDateTime(new Date(multiDay.endsAt), 'en'));
  });

  it('omits optional rows when there is no end, venue, host or summary', () => {
    const bare: PublicEvent = {
      ...EVENT,
      endsAt: null,
      location: null,
      branchName: null,
      summary: null,
    };
    const { container } = renderWithIntl(<EventList events={[bare]} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    const copy = messages('en').events;
    expect(container.querySelectorAll('time')).toHaveLength(1);
    expect(screen.queryByText(copy.where)).toBeNull();
    expect(screen.queryByText(copy.hostedBy)).toBeNull();
    expect(container).not.toHaveTextContent('until');
  });

  it('renders a summary containing markup as visible text, never as an element', () => {
    const hostile = { ...EVENT, summary: '<script>x</script> **bold** <b>tag</b>' };
    const { container } = renderWithIntl(<EventList events={[hostile]} locale="en" />, {
      locale: 'en',
      namespaces: NAMESPACES,
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(container).toHaveTextContent('<script>x</script> **bold** <b>tag</b>');
  });

  it('marks an English event on the Urdu page with lang, dir and a note', () => {
    const { container } = renderWithIntl(<EventList events={[EVENT]} locale="ur" />, {
      locale: 'ur',
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('note')).toHaveTextContent(messages('ur').events.fallbackNote);
    const heading = container.querySelector('h3');
    expect(heading).toHaveAttribute('lang', 'en');
    expect(heading).toHaveAttribute('dir', 'ltr');
    const summary = screen.getByText(/Bring your family\./);
    expect(summary).toHaveAttribute('lang', 'en');
    expect(summary).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(messages('ur').events.where).closest('[lang]')).toBe(container);
  });

  it.each(LOCALES)('shows a friendly empty state in %s', (locale) => {
    const copy = messages(locale).events.empty;
    const { container } = renderWithIntl(<EventList events={[]} locale={locale} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.querySelector('ol')).toBeNull();
    const status = screen.getByRole('status', { hidden: true });
    expect(status).toHaveTextContent(copy.title);
    expect(status).toHaveTextContent(copy.body);
  });

  it.each(LOCALES)(
    'reads in %s with times kept left to right and only logical classes',
    (locale) => {
      const event = { ...EVENT, locale };
      const { container } = renderWithIntl(<EventList events={[event]} locale={locale} />, {
        locale,
        namespaces: NAMESPACES,
      });
      expect(container).toHaveAttribute('lang', locale);
      expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      const times = Array.from(container.querySelectorAll('time'));
      expect(times).toHaveLength(2);
      for (const time of times) {
        expect(time.closest('bdi, [dir="ltr"]')).not.toBeNull();
        expect(time.textContent).toMatch(/^[\x20-\x7e؀-ۿ\s,]+$/);
        expect(time.textContent).not.toMatch(/[۰-۹٠-٩]/);
      }
      expect(times[0]).toHaveTextContent(formatDateTime(new Date(EVENT.startsAt), locale));
      expect(times[1]?.textContent).toBe('13:00');
      expect(screen.queryByRole('note')).toBeNull();
      expectNoPhysicalClasses(container);
    },
  );
});
