// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { ImpactBranches } from './ImpactBranches';
import { ImpactFigures } from './ImpactFigures';

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'impact'];
const PHYSICAL =
  /(^|\s)(ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)(-|\s|$)/;

type ImpactMessages = {
  figures: Record<string, string>;
  branches: { title: string; otherCity: string; empty: string };
};

function messages(locale: 'en' | 'ur'): ImpactMessages {
  const file = path.resolve(import.meta.dirname, `../../../messages/${locale}/impact.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as ImpactMessages;
}

function expectNoPhysicalClasses(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const className = el.getAttribute('class') ?? '';
    expect(className, `<${el.tagName.toLowerCase()} class="${className}">`).not.toMatch(PHYSICAL);
  }
}

const FIGURES = {
  approvedTotal: '4692717.65',
  approvedReportCount: 1234,
  monthsCovered: 3,
  activeBranchCount: 5,
  cities: 4,
};

const BRANCHES = [
  { name: 'Clifton', city: 'Karachi' },
  { name: 'Gulberg', city: 'Lahore' },
  { name: 'ماڈل ٹاؤن', city: 'Lahore' },
  { name: 'Riverside', city: null },
];

function figure(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-impact-figure="${id}"]`);
  expect(el, id).not.toBeNull();
  return el!;
}

describe.each(LOCALES)('ImpactFigures (%s)', (locale) => {
  const m = messages(locale).figures;

  it('shows the approved total with its label and hint, isolated left to right', () => {
    const { container } = renderWithIntl(<ImpactFigures {...FIGURES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const total = figure(container, 'approvedTotal');
    expect(within(total).getByText(m.approvedTotal!)).toBeTruthy();
    expect(within(total).getByText(m.approvedTotalHint!)).toBeTruthy();
    const money = within(total).getByText('PKR 4,692,717.65');
    expect(money.closest('bdi')?.getAttribute('dir')).toBe('ltr');
  });

  it('shows the two supporting figures and the two small figures with grouped Latin digits', () => {
    const { container } = renderWithIntl(<ImpactFigures {...FIGURES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const expectations: [string, string, string][] = [
      ['reports', m.reports!, '1,234'],
      ['months', m.months!, '3'],
      ['branches', m.branches!, '5'],
      ['cities', m.cities!, '4'],
    ];
    for (const [id, label, value] of expectations) {
      const el = figure(container, id);
      expect(within(el).getByText(label)).toBeTruthy();
      expect(within(el).getByText(value).closest('bdi')?.getAttribute('dir')).toBe('ltr');
    }
    expect(within(figure(container, 'reports')).getByText(m.reportsHint!)).toBeTruthy();
    expect(within(figure(container, 'months')).getByText(m.monthsHint!)).toBeTruthy();
  });

  it('pairs every label with a value in description lists and has a section heading', () => {
    const { container } = renderWithIntl(<ImpactFigures {...FIGURES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.querySelectorAll('dt')).toHaveLength(5);
    for (const dl of Array.from(container.querySelectorAll('dl'))) {
      for (const child of Array.from(dl.children)) {
        expect(['DT', 'DD', 'DIV']).toContain(child.tagName);
      }
    }
    const section = container.querySelector('section')!;
    const heading = screen.getByRole('heading', { level: 2, name: m.title });
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('sets the locale direction and uses logical classes only', () => {
    const { container } = renderWithIntl(<ImpactFigures {...FIGURES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');
    expectNoPhysicalClasses(container);
  });
});

describe.each(LOCALES)('ImpactBranches (%s)', (locale) => {
  const m = messages(locale).branches;

  it('groups branches by city in the given order, with branches without a city last', () => {
    const { container } = renderWithIntl(<ImpactBranches branches={BRANCHES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const cities = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(cities).toEqual(['Karachi', 'Lahore', m.otherCity]);
    const lahore = container.querySelector<HTMLElement>('[data-impact-city="Lahore"]')!;
    const names = within(lahore)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(names).toEqual(['Gulberg', 'ماڈل ٹاؤن']);
  });

  it('isolates branch and city names with bdi and shows a count per city', () => {
    const { container } = renderWithIntl(<ImpactBranches branches={BRANCHES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const urduName = screen.getByText('ماڈل ٹاؤن');
    expect(urduName.tagName).toBe('BDI');
    expect(urduName.getAttribute('dir')).toBeNull();
    expect(screen.getByText('Karachi').tagName).toBe('BDI');
    const lahore = container.querySelector<HTMLElement>('[data-impact-city="Lahore"]')!;
    expect(within(lahore).getByText(/2/)).toBeTruthy();
  });

  it('has a titled section and logical classes only', () => {
    const { container } = renderWithIntl(<ImpactBranches branches={BRANCHES} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const heading = screen.getByRole('heading', { level: 2, name: m.title });
    expect(container.querySelector('section')!.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');
    expectNoPhysicalClasses(container);
  });

  it('shows a calm empty message when there is no active branch', () => {
    renderWithIntl(<ImpactBranches branches={[]} />, { locale, namespaces: NAMESPACES });
    expect(screen.getByText(m.empty)).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});
