// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import { useMessages } from 'next-intl';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { ConfirmDialog, DataTable, EmptyState, ErrorState, StatusBadge, ThemeToggle } from '.';

const LOCALES = ['en', 'ur'] as const;
const GLOBALS = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');

beforeEach(() => {
  // jsdom has no modal dialog support
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  document.documentElement.removeAttribute('data-theme');
});

describe('renderWithIntl', () => {
  it('sets lang and dir on the container', () => {
    const { container } = renderWithIntl(<p>x</p>, { locale: 'ur' });
    expect(container).toHaveAttribute('lang', 'ur');
    expect(container).toHaveAttribute('dir', 'rtl');
    const en = renderWithIntl(<p>y</p>);
    expect(en.container).toHaveAttribute('dir', 'ltr');
  });

  it('loads every requested namespace', () => {
    function Keys() {
      return <p data-testid="keys">{Object.keys(useMessages()).join(',')}</p>;
    }
    renderWithIntl(<Keys />, { namespaces: ['common', 'shell'] });
    expect(screen.getByTestId('keys')).toHaveTextContent('common,shell');
  });

  it('throws a clear error for an unknown namespace', () => {
    expect(() => renderWithIntl(<p>x</p>, { namespaces: ['nope'] })).toThrow(
      /unknown namespace "nope"/,
    );
  });
});

describe('StatusBadge', () => {
  it('renders the translated label with the success tone', () => {
    renderWithIntl(<StatusBadge status="approved" />);
    const badge = screen.getByText('Approved');
    expect(badge).toHaveAttribute('data-tone', 'success');
    expect(badge.className).toContain('bg-tone-success-bg');
  });

  it('falls back to the raw status with the neutral tone', () => {
    renderWithIntl(<StatusBadge status="mystery" />);
    const badge = screen.getByText('mystery');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
  });

  it('prefers an explicit label', () => {
    renderWithIntl(<StatusBadge status="draft" label="Custom" />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('translates to Urdu', () => {
    renderWithIntl(<StatusBadge status="approved" />, { locale: 'ur' });
    expect(screen.getByText('منظور شدہ')).toBeInTheDocument();
  });
});

type Row = { id: string; name: string; amount: string };
const rows: Row[] = [
  { id: 'a', name: 'Lahore', amount: 'PKR 1,500.00' },
  { id: 'b', name: 'Karachi', amount: 'PKR 20,000.00' },
];
const columns = [
  { key: 'name', header: 'Branch', render: (r: Row) => r.name },
  { key: 'amount', header: 'Total', align: 'numeric' as const, render: (r: Row) => r.amount },
];

describe('DataTable', () => {
  it('renders caption, column headers and one row per item', () => {
    renderWithIntl(
      <DataTable caption="Branches" columns={columns} rows={rows} getRowKey={(r) => r.id} />,
    );
    expect(screen.getByRole('table', { name: 'Branches' })).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(2);
    headers.forEach((h) => expect(h).toHaveAttribute('scope', 'col'));
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('isolates numeric cells left-to-right and aligns them to the end', () => {
    renderWithIntl(
      <DataTable caption="Branches" columns={columns} rows={rows} getRowKey={(r) => r.id} />,
      { locale: 'ur' },
    );
    const cell = screen.getByText('PKR 1,500.00');
    expect(cell).toHaveAttribute('dir', 'ltr');
    expect(cell.closest('td')?.className).toContain('text-end');
    expect(cell.closest('td')?.className).toContain('tabular');
  });

  it('can hide the caption visually while keeping it for screen readers', () => {
    renderWithIntl(
      <DataTable
        caption="Branches"
        captionHidden
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('Branches').className).toContain('sr-only');
  });

  it('renders the empty state instead of an empty table', () => {
    renderWithIntl(
      <DataTable caption="Branches" columns={columns} rows={[]} getRowKey={(r) => r.id} />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here yet');
  });

  it('uses a custom empty node when supplied', () => {
    renderWithIntl(
      <DataTable
        caption="Branches"
        columns={columns}
        rows={[]}
        getRowKey={(r) => r.id}
        empty={<p>No branches</p>}
      />,
    );
    expect(screen.getByText('No branches')).toBeInTheDocument();
  });

  it('wraps in a scroll container and renders a footer', () => {
    renderWithIntl(
      <DataTable
        caption="Branches"
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        footer={
          <tr>
            <td>Total</td>
            <td>PKR 21,500.00</td>
          </tr>
        }
      />,
    );
    const table = screen.getByRole('table');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect(screen.getByText('PKR 21,500.00')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('shows title, body and action', () => {
    renderWithIntl(<EmptyState action={<button type="button">Add</button>} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Nothing here yet');
    expect(el).toHaveTextContent('Records will appear here');
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('accepts overrides', () => {
    renderWithIntl(<EmptyState title="No reports" body="Create one." />);
    expect(screen.getByText('No reports')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('is an alert with a retry button', async () => {
    const onRetry = vi.fn();
    renderWithIntl(<ErrorState onRetry={onRetry} />, { locale: 'ur' });
    expect(screen.getByRole('alert')).toHaveTextContent('کچھ خرابی پیش آ گئی');
    await userEvent.click(screen.getByRole('button', { name: 'دوبارہ کوشش کریں' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button without a handler', () => {
    renderWithIntl(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

function Harness({
  tone,
  onConfirm = () => {},
  onCancel = () => {},
}: {
  tone?: 'default' | 'destructive';
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        tone={tone}
        title="Void collection?"
        description="This cannot be undone."
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('opens as a labelled modal dialog', async () => {
    renderWithIntl(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Void collection?' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('puts initial focus on cancel for destructive tone and returns focus on close', async () => {
    const onCancel = vi.fn();
    renderWithIntl(<Harness tone="destructive" onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it('calls onConfirm from the confirm button', async () => {
    const onConfirm = vi.fn();
    renderWithIntl(<Harness tone="destructive" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.className).toContain('bg-danger');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('focuses the confirm button for the default tone', async () => {
    renderWithIntl(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });

  it('renders in Urdu', async () => {
    renderWithIntl(<Harness />, { locale: 'ur' });
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'منسوخ کریں' })).toBeInTheDocument();
  });
});

describe('ThemeToggle', () => {
  it('sets data-theme and the theme cookie, and reflects the choice with aria-pressed', async () => {
    renderWithIntl(<ThemeToggle />);
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.cookie).toContain('theme=dark');
    expect(await screen.findByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe.each(LOCALES)('logical-only markup (%s)', (locale) => {
  it('emits no physical-direction classes from any component', async () => {
    const { container } = renderWithIntl(
      <>
        <StatusBadge status="approved" />
        <DataTable
          caption="Branches"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          footer={
            <tr>
              <td>t</td>
            </tr>
          }
        />
        <DataTable caption="Empty" columns={columns} rows={[]} getRowKey={(r) => r.id} />
        <EmptyState action={<button type="button">Add</button>} />
        <ErrorState onRetry={() => {}} />
        <ThemeToggle />
        <Harness tone="destructive" />
      </>,
      { locale },
    );
    await userEvent.click(screen.getByRole('button', { name: /^(Open)$/ }));
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });
});

function themeBlocks() {
  const body = (start: string) => {
    const open = GLOBALS.indexOf('{', GLOBALS.indexOf(start));
    let depth = 0;
    for (let i = open; i < GLOBALS.length; i++) {
      if (GLOBALS[i] === '{') depth++;
      if (GLOBALS[i] === '}' && --depth === 0) return GLOBALS.slice(open + 1, i);
    }
    throw new Error(`block not found: ${start}`);
  };
  const vars = (text: string) =>
    Object.fromEntries(
      [...text.matchAll(/(--color-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]),
    );
  const light = vars(body('@theme static'));
  const dark = vars(body(":root[data-theme='dark']"));
  const system = vars(body(":root:not([data-theme='light'])"));
  return {
    light,
    dark: { ...light, ...dark },
    darkOnly: dark,
    system: { ...light, ...system },
    systemOnly: system,
  };
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  const { light, dark, darkOnly, systemOnly } = themeBlocks();
  const tones = ['neutral', 'info', 'success', 'warning', 'danger', 'pending'];
  const pairs: [string, string, number][] = [
    ['text', 'surface', 4.5],
    ['text', 'surface-raised', 4.5],
    ['text', 'surface-sunken', 4.5],
    ['text-muted', 'surface', 4.5],
    ['text-muted', 'surface-raised', 4.5],
    ['text-muted', 'surface-sunken', 4.5],
    ['primary-contrast', 'primary', 4.5],
    ['primary-contrast', 'primary-hover', 4.5],
    ['primary', 'surface', 4.5],
    ['primary', 'surface-raised', 4.5],
    ['accent', 'surface', 4.5],
    ['accent', 'surface-raised', 4.5],
    ['text', 'accent-soft', 4.5],
    ['danger-contrast', 'danger', 4.5],
    ['danger-contrast', 'danger-hover', 4.5],
    ['border-strong', 'surface', 3],
    ['border-strong', 'surface-raised', 3],
    ['ring', 'surface', 3],
    ['ring', 'surface-raised', 3],
    ...tones.map((t): [string, string, number] => [`tone-${t}-fg`, `tone-${t}-bg`, 4.5]),
  ];

  describe.each([
    ['light', light],
    ['dark', dark],
  ])('%s mode', (_mode, set) => {
    it.each(pairs)('%s on %s reaches the WCAG AA minimum', (fg, bg, min) => {
      expect(contrast(set[`--color-${fg}`]!, set[`--color-${bg}`]!)).toBeGreaterThanOrEqual(min);
    });
  });

  it('keeps the explicit dark block and the system dark block identical', () => {
    expect(systemOnly).toEqual(darkOnly);
  });
});
