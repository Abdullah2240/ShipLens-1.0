// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { APPLICATION_ERROR_CODES } from '../schema';
import { ApplicationForm, type ApplicationFormProps } from './ApplicationForm';

const push = vi.hoisted(() => vi.fn());

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test),
// so the router is replaced by a stand-in that records pushes.
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'applications'];

const LAHORE = '3f1c2b9e-8a4d-4c1e-9b2a-1d2e3f4a5b6c';
const KARACHI = 'a7e2d4c1-5b3f-4e8a-8c9d-0f1e2d3c4b5a';
const BRANCHES: ApplicationFormProps['branches'] = [
  { id: LAHORE, name: 'Lahore Central', city: 'Lahore' },
  { id: KARACHI, name: 'Karachi Harbour', city: null },
];

function messages(locale: Locale): Record<string, unknown> {
  const file = path.resolve(
    import.meta.dirname,
    `../../../../messages/${locale}/applications.json`,
  );
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function raw(locale: Locale, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      messages(locale),
    );
  if (typeof value !== 'string') throw new Error(`missing applications message ${locale}:${key}`);
  return value;
}

// Rendered text of a message: rich tags such as <ltr> wrap text but add none.
const msg = (locale: Locale, key: string) => raw(locale, key).replace(/<\/?ltr>/g, '');

function renderForm(props: Partial<ApplicationFormProps> = {}, locale: Locale = 'en') {
  return renderWithIntl(<ApplicationForm branches={BRANCHES} {...props} />, {
    locale,
    namespaces: NAMESPACES,
  });
}

function field(locale: Locale, name: 'fullName' | 'email' | 'phone' | 'message' | 'branch') {
  return screen.getByLabelText(new RegExp(`^${msg(locale, `form.fields.${name}.label`)}`));
}

function errorFor(element: HTMLElement): HTMLElement {
  expect(element).toHaveAttribute('aria-invalid', 'true');
  const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const errors = ids
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLElement => node?.dataset.error === 'true');
  expect(errors).toHaveLength(1);
  return errors[0]!;
}

function submitButton(locale: Locale = 'en') {
  return screen.getByRole('button', { name: msg(locale, 'form.submit') });
}

async function fillValid(user: ReturnType<typeof userEvent.setup>, locale: Locale = 'en') {
  await user.type(field(locale, 'fullName'), '  Ayesha Khan  ');
  await user.type(field(locale, 'email'), ' ayesha@example.org ');
  await user.type(field(locale, 'phone'), '0300 1234567');
  await user.type(field(locale, 'message'), ' I can teach on weekends. ');
  await user.selectOptions(field(locale, 'branch'), LAHORE);
}

function respond(status: number, body: unknown = {}) {
  return vi.fn(async () => Response.json(body, { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockReset();
  fetchMock = respond(201, { ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// userEvent.type enters one character at a time, so the submit flows take a few seconds each;
// under full-suite load they need more than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

describe('ApplicationForm fields', () => {
  it('labels every input and sets autocomplete and direction', () => {
    renderForm();
    expect(field('en', 'fullName')).toHaveAttribute('autocomplete', 'name');
    const email = field('en', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('dir', 'ltr');
    const phone = field('en', 'phone');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(phone).toHaveAttribute('dir', 'ltr');
    expect(field('en', 'message').tagName).toBe('TEXTAREA');
    for (const name of ['fullName', 'email', 'phone', 'message', 'branch'] as const) {
      expect(field('en', name)).not.toHaveAttribute('required');
    }
    expect(screen.getByRole('button', { name: msg('en', 'form.submit') })).toBeEnabled();
    expect(document.querySelector('form')).toHaveAttribute('novalidate');
  });

  it('lists branches as "name, city" and falls back to the name alone', () => {
    renderForm();
    const select = field('en', 'branch') as HTMLSelectElement;
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual([
      msg('en', 'form.branchPlaceholder'),
      'Lahore Central, Lahore',
      'Karachi Harbour',
    ]);
    expect(select.value).toBe('');
  });

  it('preselects defaultBranchId only when it is in the list', () => {
    renderForm({ defaultBranchId: KARACHI });
    expect((field('en', 'branch') as HTMLSelectElement).value).toBe(KARACHI);
  });

  it('ignores a defaultBranchId that is not offered', () => {
    renderForm({ defaultBranchId: '11111111-2222-4333-8444-555555555555' });
    expect((field('en', 'branch') as HTMLSelectElement).value).toBe('');
  });
});

describe('ApplicationForm honeypot', () => {
  it('is hidden from assistive tech, off-screen with a logical utility and out of tab order', async () => {
    const user = userEvent.setup();
    renderForm();
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(honeypot).not.toBeNull();
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
    const wrapper = honeypot.closest('[aria-hidden="true"]') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toMatch(/(^|\s)-start-/);
    expect(wrapper!.className).not.toMatch(/left|right/);

    const visited: Element[] = [];
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      visited.push(document.activeElement!);
      if (document.activeElement === submitButton()) break;
    }
    expect(visited).toContain(submitButton());
    expect(visited).not.toContain(honeypot);
  });
});

describe('ApplicationForm client validation', () => {
  it('blocks an empty submit with inline errors, a summary and focus on the first field', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(submitButton());

    expect(fetchMock).not.toHaveBeenCalled();
    const name = field('en', 'fullName');
    expect(errorFor(name)).toHaveTextContent(msg('en', 'form.errors.required'));
    expect(errorFor(field('en', 'email'))).toHaveTextContent(msg('en', 'form.errors.required'));
    expect(errorFor(field('en', 'branch'))).toHaveTextContent(
      msg('en', 'form.errors.invalid_branch'),
    );
    expect(field('en', 'phone')).toHaveAttribute('aria-invalid', 'false');
    expect(field('en', 'message')).toHaveAttribute('aria-invalid', 'false');
    expect(name).toHaveFocus();

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Please check 3 answers before sending');
    const links = within(summary).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', `#${name.id}`);

    await user.click(links[2]!);
    expect(field('en', 'branch')).toHaveFocus();
  });

  it('translates too_short, invalid_email and invalid_phone and clears an error once fixed', async () => {
    const user = userEvent.setup();
    renderForm({ defaultBranchId: LAHORE });
    await user.type(field('en', 'fullName'), 'A');
    await user.type(field('en', 'email'), 'not-an-email');
    await user.type(field('en', 'phone'), '12345');
    await user.click(submitButton());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorFor(field('en', 'fullName'))).toHaveTextContent(msg('en', 'form.errors.too_short'));
    expect(errorFor(field('en', 'email'))).toHaveTextContent(
      msg('en', 'form.errors.invalid_email'),
    );
    expect(errorFor(field('en', 'phone'))).toHaveTextContent(
      msg('en', 'form.errors.invalid_phone'),
    );
    expect(field('en', 'fullName')).toHaveFocus();

    await user.type(field('en', 'fullName'), 'yesha');
    expect(field('en', 'fullName')).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows errors in Urdu for an Urdu visitor', async () => {
    const user = userEvent.setup();
    renderForm({}, 'ur');
    await user.type(field('ur', 'email'), 'nope');
    await user.click(submitButton('ur'));
    expect(errorFor(field('ur', 'fullName'))).toHaveTextContent(msg('ur', 'form.errors.required'));
    const emailError = errorFor(field('ur', 'email'));
    expect(emailError).toHaveTextContent(msg('ur', 'form.errors.invalid_email'));
    expect(emailError.querySelector('bdi[dir="ltr"]')).toHaveTextContent('name@example.com');
  });
});

describe('ApplicationForm submit', () => {
  it('posts trimmed JSON, shows the pending state and goes to the thanks page on 201', async () => {
    let release: (r: Response) => void = () => {};
    fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(submitButton());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/public/applications');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      fullName: 'Ayesha Khan',
      email: 'ayesha@example.org',
      phone: '0300 1234567',
      message: 'I can teach on weekends.',
      branchId: LAHORE,
      website: '',
    });

    const pending = screen.getByRole('button', { name: msg('en', 'form.submitting') });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(Response.json({ ok: true }, { status: 201 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/get-involved/apply/thanks'));
  });

  it('sends the honeypot value so the server can discard the submission', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    await user.type(honeypot, 'https://spam.example');
    await user.click(submitButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.website).toBe('https://spam.example');
  });

  it('maps 422 field codes to field errors, with a generic fallback for unknown codes', async () => {
    fetchMock = respond(422, {
      error: {
        code: 'validation_failed',
        details: {
          fields: [
            { path: 'email', code: 'custom', message: 'invalid_email' },
            { path: 'phone', code: 'custom', message: 'something_new' },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillValid(user);
    await user.click(submitButton());

    await waitFor(() =>
      expect(errorFor(field('en', 'email'))).toHaveTextContent(
        msg('en', 'form.errors.invalid_email'),
      ),
    );
    expect(errorFor(field('en', 'phone'))).toHaveTextContent(msg('en', 'form.errors.generic'));
    expect(field('en', 'email')).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
    expect(field('en', 'fullName')).toHaveValue('  Ayesha Khan  ');
    expect(submitButton()).toBeEnabled();
  });

  it.each([
    [409, { error: { code: 'duplicate_application' } }, 'form.errors.duplicate'],
    [429, { error: { code: 'rate_limited' } }, 'form.errors.rateLimited'],
    [500, { error: { code: 'internal_error' } }, 'form.errors.generic'],
    [422, { error: { code: 'validation_failed', details: { fields: [] } } }, 'form.errors.generic'],
  ])(
    'shows the right message for a %i response and keeps the answers',
    async (status, body, key) => {
      fetchMock = respond(status, body);
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderForm();
      await fillValid(user);
      await user.click(submitButton());

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(msg('en', key));
      await waitFor(() => expect(alert).toHaveFocus());
      expect(push).not.toHaveBeenCalled();
      // Browsers strip surrounding spaces from type=email values; the other fields keep them.
      expect(field('en', 'email')).toHaveValue('ayesha@example.org');
      expect(field('en', 'message')).toHaveValue(' I can teach on weekends. ');
      expect((field('en', 'branch') as HTMLSelectElement).value).toBe(LAHORE);
      expect(submitButton()).toBeEnabled();
    },
  );

  it('shows the generic message when the network fails', async () => {
    fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm({}, 'ur');
    await fillValid(user, 'ur');
    await user.click(submitButton('ur'));

    expect(await screen.findByRole('alert')).toHaveTextContent(msg('ur', 'form.errors.generic'));
    expect(field('ur', 'fullName')).toHaveValue('  Ayesha Khan  ');
  });
});

describe('ApplicationForm messages and direction', () => {
  it('has a translation for every schema error code in both locales', () => {
    for (const locale of LOCALES) {
      for (const code of APPLICATION_ERROR_CODES) {
        expect(raw(locale, `form.errors.${code}`), `${locale}:${code}`).not.toBe('');
      }
    }
  });

  it.each(LOCALES)(
    'renders in %s with the right lang and dir and no physical classes',
    (locale) => {
      const { container } = renderForm({}, locale);
      expect(container).toHaveAttribute('lang', locale);
      expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
      expect(
        screen.getByLabelText(new RegExp(`^${msg(locale, 'form.fields.fullName.label')}`)),
      ).toBeInTheDocument();
      const physical = /(^|\s)(ml|mr|pl|pr|left|right|text-left|text-right)-?/;
      for (const element of Array.from(container.querySelectorAll('*'))) {
        const className = element.getAttribute('class') ?? '';
        expect(className, element.tagName).not.toMatch(physical);
      }
    },
  );

  it('keeps the component source free of physical-direction utilities', () => {
    const file = path.resolve(import.meta.dirname, 'ApplicationForm.tsx');
    expect(findPhysicalDirection(readFileSync(file, 'utf8'), 'ApplicationForm.tsx')).toEqual([]);
  });
});
