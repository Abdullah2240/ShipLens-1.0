// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import enExports from '../../../../../messages/en/exports.json';
import urExports from '../../../../../messages/ur/exports.json';
import { AppShell } from '@/components/shell/AppShell';
import { MoneyText } from '@/components/ui';
import { PRINT_AUDIT_PATH, PrintButton } from './PrintButton';
import {
  PRINT_CSS,
  PrintDate,
  PrintMeta,
  PrintSection,
  PrintSheet,
  PrintTable,
  PrintToolbar,
} from './PrintSheet';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/print',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.setConfig({ testTimeout: 20000 });

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'exports', 'shell'];

function printMessages(locale: 'en' | 'ur') {
  return locale === 'en' ? enExports.print : urExports.print;
}

function noPhysicalClasses(container: HTMLElement) {
  expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
}

let fetchMock: ReturnType<typeof vi.fn>;
let printMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  printMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  window.print = printMock as unknown as typeof window.print;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(LOCALES)('PrintButton (%s)', (locale) => {
  const m = printMessages(locale);

  it('records the print once, then opens the print dialog', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } })));
    const { container } = renderWithIntl(
      <PrintButton
        kind="print_report"
        reportId="0f0f0f0f-0000-4000-8000-000000000000"
        rowCount={5}
      />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.click(screen.getByRole('button', { name: m.button }));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(PRINT_AUDIT_PATH);
    expect(url).toBe('/api/v1/exports/print');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'print_report',
      reportId: '0f0f0f0f-0000-4000-8000-000000000000',
      rowCount: 5,
    });
    // The audit call resolves before the dialog opens.
    expect(fetchMock.mock.invocationCallOrder[0]!).toBeLessThan(
      printMock.mock.invocationCallOrder[0]!,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    noPhysicalClasses(container);
  });

  it('sends no reportId for a summary print', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    renderWithIntl(<PrintButton kind="print_summary" rowCount={22} />, {
      locale,
      namespaces: NAMESPACES,
    });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'print_summary', rowCount: 22 });
  });

  it('shows the localized error and does not print when the record fails', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":"forbidden"}}', { status: 403 }));
    renderWithIntl(<PrintButton kind="print_summary" rowCount={1} />, {
      locale,
      namespaces: NAMESPACES,
    });
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.error);
    expect(printMock).not.toHaveBeenCalled();
  });

  it('treats a network failure the same way', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderWithIntl(<PrintButton kind="print_summary" rowCount={1} />, {
      locale,
      namespaces: NAMESPACES,
    });
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.error);
    expect(printMock).not.toHaveBeenCalled();
  });

  it('is busy while the record is written and ignores a second click', async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderWithIntl(<PrintButton kind="print_summary" rowCount={1} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent(m.preparing));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    resolve(new Response('{}'));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent(m.button);
  });

  it('is hidden in print', () => {
    const { container } = renderWithIntl(<PrintButton kind="print_summary" rowCount={1} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect((container.firstElementChild as HTMLElement).className).toContain('print:hidden');
  });
});

describe.each(LOCALES)('PrintSheet (%s)', (locale) => {
  const m = printMessages(locale);

  function renderSheet() {
    return renderWithIntl(
      <PrintSheet
        title="Funds summary"
        meta={
          <PrintMeta
            label={m.filters}
            items={[
              { key: 'months', label: 'Months', value: 'All time' },
              {
                key: 'asOf',
                label: m.asOf,
                value: <PrintDate value="2026-10-31T10:15:00.000Z" withTime />,
              },
              { key: 'for', label: m.generatedFor, value: <bdi>Faraz Finance</bdi> },
            ]}
          />
        }
      >
        <PrintSection title={m.figures} note="A note">
          <PrintTable
            caption={m.figures}
            columns={[
              { key: 'figure', header: 'Figure' },
              { key: 'value', header: 'Value', numeric: true },
            ]}
            rows={[
              { key: 'a', cells: ['Collected', <MoneyText key="v" amount="2100.75" />] },
              { key: 'b', cells: ['Approved', <MoneyText key="v" amount="1750.50" />] },
            ]}
            footer={['Total', <MoneyText key="t" amount="3851.25" />]}
          />
        </PrintSection>
      </PrintSheet>,
      { locale, namespaces: NAMESPACES },
    );
  }

  it('renders the letterhead, meta, body and closing note', () => {
    const { container } = renderSheet();
    const sheet = container.querySelector('article[data-print-sheet]') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Funds summary');
    expect(within(sheet).getByText('ShipLens')).toBeInTheDocument();
    expect(within(sheet).getByText(m.documentKind)).toBeInTheDocument();
    const meta = within(sheet).getByLabelText(m.filters);
    expect(meta.tagName).toBe('DL');
    expect(within(meta).getByText(m.generatedFor)).toBeInTheDocument();
    expect(within(meta).getByText('Faraz Finance')).toBeInTheDocument();
    expect(meta.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-31T10:15:00.000Z');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(m.figures);
    expect(sheet.querySelector('footer')).toHaveTextContent(m.pageNote);
    noPhysicalClasses(container);
  });

  it('prints black on white whatever the theme, on A4', () => {
    const { container } = renderSheet();
    const sheet = container.querySelector('article[data-print-sheet]') as HTMLElement;
    expect(sheet.className).toContain('print:bg-white');
    expect(sheet.className).toContain('print:text-black');
    const style = container.querySelector('style')!.textContent!;
    expect(style).toBe(PRINT_CSS);
    expect(style).toMatch(/@page\s*{[^}]*size:\s*A4;\s*margin:\s*14mm;/);
    expect(style).toContain(':root[data-theme]');
    expect(style).toContain('--color-text: #000000;');
    expect(style).toContain('[data-print-row] { break-inside: avoid; }');
    expect(style).toContain('[data-print-heading] { break-after: avoid; }');
    expect(style).toContain('a { color: inherit; text-decoration: none; }');
  });

  it('keeps table rows whole and figures at the inline end', () => {
    const { container } = renderSheet();
    const table = screen.getByRole('table', { name: m.figures });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    for (const row of rows.slice(1)) expect(row).toHaveAttribute('data-print-row');
    const heading = container.querySelector('[data-print-heading]');
    expect(heading).toHaveTextContent(m.figures);
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('Collected');
    const value = within(rows[1]!).getByRole('cell');
    expect(value.className).toContain('text-end');
    expect(value.className).toContain('tabular');
    expect(table.querySelector('tfoot')).toHaveTextContent('Total');
    // The scroll wrapper lets go of its overflow in print.
    expect(screen.getByRole('region', { name: m.figures }).className).toContain(
      'print:overflow-visible',
    );
  });
});

describe.each(LOCALES)('print helpers (%s)', (locale) => {
  const m = printMessages(locale);

  it('PrintTable shows the empty note when there are no rows', () => {
    renderWithIntl(
      <PrintTable caption="x" columns={[{ key: 'a', header: 'A' }]} rows={[]} empty={m.noRows} />,
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(m.noRows)).toBeInTheDocument();
  });

  it('PrintDate isolates with automatic direction so Urdu dates keep their order', () => {
    const { container } = renderWithIntl(
      <p>
        <PrintDate value="2026-10-15T08:06:00.000Z" withTime />
        <PrintDate value="2026-08-31" />
      </p>,
      { locale, namespaces: NAMESPACES },
    );
    const [instant, day] = Array.from(container.querySelectorAll('bdi'));
    expect(instant!.hasAttribute('dir')).toBe(false);
    expect(instant!.querySelector('time')!.getAttribute('dateTime')).toBe(
      '2026-10-15T08:06:00.000Z',
    );
    expect(instant!.textContent).toMatch(/13:06/);
    expect(day!.textContent).toMatch(/31/);
    expect(day!.textContent).toMatch(/2026/);
  });

  it('PrintToolbar has the back link and its children, hidden in print', () => {
    const { container } = renderWithIntl(
      <PrintToolbar backHref="/dashboard?from=2026-08">
        <button type="button">go</button>
      </PrintToolbar>,
      { locale, namespaces: NAMESPACES },
    );
    const group = screen.getByRole('group', { name: m.toolbar });
    expect(group.className).toContain('print:hidden');
    expect(within(group).getByRole('link', { name: m.back })).toHaveAttribute(
      'href',
      '/dashboard?from=2026-08',
    );
    expect(within(group).getByText(m.hint)).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'go' })).toBeInTheDocument();
    noPhysicalClasses(container);
  });
});

describe.each(LOCALES)('AppShell in print (%s)', (locale) => {
  it('hides the header and its navigation when printing', () => {
    renderWithIntl(
      <AppShell
        items={[{ id: 'dashboard', href: '/dashboard', labelKey: 'nav.dashboard' } as never]}
      >
        <p>content</p>
      </AppShell>,
      { locale, namespaces: NAMESPACES },
    );
    const header = screen.getByRole('banner');
    expect(header.className).toContain('print:hidden');
    expect(within(header).getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(screen.getByRole('main').className).not.toContain('print:hidden');
  });
});
