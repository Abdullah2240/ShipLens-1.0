// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { LoginForm } from './LoginForm';
import { LogoutButton } from './LogoutButton';

// jsdom plus user-event is slow on a busy machine; same allowance as content-ui.test.
vi.setConfig({ testTimeout: 20000 });

const nav = vi.hoisted(() => ({
  locale: 'en',
  // Where the browser would end up, as a full locale-prefixed path.
  landed: [] as string[],
  localeReplace: vi.fn(),
  localeRefresh: vi.fn(),
  plainReplace: vi.fn(),
  plainRefresh: vi.fn(),
}));

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test).
// The stand-in prefixes the current locale the way the real locale-aware router does,
// while the plain next/navigation router takes the path as given.
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    replace: (href: string) => {
      nav.localeReplace(href);
      nav.landed.push(`/${nav.locale}${href}`);
    },
    refresh: nav.localeRefresh,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (href: string) => {
      nav.plainReplace(href);
      nav.landed.push(href);
    },
    refresh: nav.plainRefresh,
  }),
}));

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'auth'];
const SHARE_PATH = '/ur/share/reports/3f1c2b9e-8a4d-4c1e-9b2a-1d2e3f4a5b6c';

function messages(locale: Locale): Record<string, unknown> {
  const file = path.resolve(import.meta.dirname, `../../../../messages/${locale}/auth.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function msg(locale: Locale, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      messages(locale),
    );
  if (typeof value !== 'string') throw new Error(`missing auth message ${locale}:${key}`);
  return value;
}

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

function emailField(locale: Locale) {
  return screen.getByLabelText(exact(msg(locale, 'email'))) as HTMLInputElement;
}
function passwordField(locale: Locale) {
  return screen.getByLabelText(exact(msg(locale, 'password'))) as HTMLInputElement;
}
function submitButton() {
  return document.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function respond(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return vi.fn(async () => Response.json(body, { status, headers }));
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

// Pasting is much faster than typing key by key and exercises the same change handler.
async function fill(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, text: string) {
  await user.click(input);
  await user.paste(text);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nav.landed.length = 0;
  nav.localeReplace.mockReset();
  nav.localeRefresh.mockReset();
  nav.plainReplace.mockReset();
  nav.plainRefresh.mockReset();
  fetchMock = respond(200, { user: { id: 'u1', name: 'Amina Khan', role: 'super_admin' } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(LOCALES)('LoginForm (%s)', (locale) => {
  beforeEach(() => {
    nav.locale = locale;
  });

  function renderForm(next: string | null = null) {
    return renderWithIntl(<LoginForm next={next} />, { locale, namespaces: NAMESPACES });
  }

  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await fill(user, emailField(locale), 'admin@shiplens.test');
    await fill(user, passwordField(locale), 'correct horse battery');
    await user.click(submitButton());
  }

  it('renders labelled email and password inputs and a submit button', () => {
    renderForm();
    const email = emailField(locale);
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toHaveAttribute('dir', 'ltr');
    const password = passwordField(locale);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(submitButton()).toHaveTextContent(msg(locale, 'submit'));
    expect(submitButton()).toBeEnabled();
    expect(document.querySelector('form')).toHaveAttribute('novalidate');
  });

  it('posts JSON with same-origin credentials', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillAndSubmit(user);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'admin@shiplens.test',
      password: 'correct horse battery',
    });
  });

  it('lands on the localised account page when there is no next path', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillAndSubmit(user);

    await waitFor(() => expect(nav.landed).toEqual([`/${locale}/account`]));
    expect(nav.localeReplace).toHaveBeenCalledWith('/account');
    expect(nav.plainReplace).not.toHaveBeenCalled();
  });

  it('lands on exactly the next path, without a second locale prefix', async () => {
    const user = userEvent.setup();
    renderForm(SHARE_PATH);
    await fillAndSubmit(user);

    await waitFor(() => expect(nav.landed).toEqual([SHARE_PATH]));
    expect(nav.localeReplace).not.toHaveBeenCalled();
  });

  it('ignores an unsafe next path and goes to the account page', async () => {
    const user = userEvent.setup();
    renderForm('//evil.test');
    await fillAndSubmit(user);

    await waitFor(() => expect(nav.landed).toEqual([`/${locale}/account`]));
  });

  it('shows one generic message on 401, focuses it, clears the password and keeps the email', async () => {
    fetchMock = respond(401, { error: { code: 'invalid_credentials' } });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(msg(locale, 'errors.invalidCredentials'));
    expect(alert).toHaveFocus();
    expect(passwordField(locale).value).toBe('');
    expect(emailField(locale).value).toBe('admin@shiplens.test');
    expect(submitButton()).toBeEnabled();
    expect(nav.landed).toEqual([]);
  });

  it('shows the retry time in minutes on 429', async () => {
    fetchMock = respond(429, { error: { code: 'rate_limited' } }, { 'Retry-After': '540' });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/9/);
    const [before] = msg(locale, 'errors.tooManyAttempts').split('{');
    expect(alert.textContent).toContain(before!.trim());
  });

  it('rounds a short Retry-After up to one minute', async () => {
    fetchMock = respond(
      429,
      { error: { code: 'rate_limited', details: { retryAfterSeconds: 20 } } },
      { 'Retry-After': '20' },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/\b1\b/);
    if (locale === 'en') expect(alert).toHaveTextContent('1 minute');
  });

  it('maps 422 field errors next to the fields', async () => {
    fetchMock = respond(422, {
      error: {
        code: 'validation_failed',
        details: {
          fields: [
            { path: 'email', code: 'too_small', message: 'too_small' },
            { path: 'password', code: 'too_big', message: 'too_big' },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fill(user, emailField(locale), 'ab');
    await fill(user, passwordField(locale), 'x');
    await user.click(submitButton());

    await waitFor(() =>
      expect(errorFor(emailField(locale))).toHaveTextContent(msg(locale, 'errors.invalidEmail')),
    );
    expect(errorFor(passwordField(locale))).toHaveTextContent(
      msg(locale, 'errors.invalidPassword'),
    );
    expect(emailField(locale)).toHaveFocus();
  });

  it('flags empty fields without calling the server', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(submitButton());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorFor(emailField(locale))).toHaveTextContent(msg(locale, 'errors.required'));
    expect(errorFor(passwordField(locale))).toHaveTextContent(msg(locale, 'errors.required'));
    expect(emailField(locale)).toHaveFocus();
  });

  it('disables and relabels the button while pending and never submits twice', async () => {
    let resolve!: (r: Response) => void;
    fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fill(user, emailField(locale), 'admin@shiplens.test');
    await fill(user, passwordField(locale), 'secret-password');
    await user.click(submitButton());

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent(msg(locale, 'submitting'));
    expect(document.querySelector('form')).toHaveAttribute('aria-busy', 'true');
    act(() => {
      document.querySelector('form')!.requestSubmit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => resolve(Response.json({ user: {} }, { status: 200 })));
    await waitFor(() => expect(nav.landed).toEqual([`/${locale}/account`]));
    // Stays pending while the next page loads.
    expect(submitButton()).toBeDisabled();
  });

  it('shows the generic message on a network failure or a server error', async () => {
    fetchMock = vi.fn(async () => {
      throw new TypeError('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(msg(locale, 'errors.generic'));

    fetchMock = respond(500, { error: { code: 'internal' } });
    vi.stubGlobal('fetch', fetchMock);
    await fill(user, passwordField(locale), 'again');
    await user.click(submitButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.generic')),
    );
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderForm();
    const toggle = screen.getByRole('button', { name: msg(locale, 'showPassword') });
    expect(toggle).toHaveAttribute('type', 'button');
    await user.click(toggle);
    expect(passwordField(locale)).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: msg(locale, 'hidePassword') }));
    expect(passwordField(locale)).toHaveAttribute('type', 'password');
  });
});

describe.each(LOCALES)('LogoutButton (%s)', (locale) => {
  beforeEach(() => {
    nav.locale = locale;
  });

  it('posts to the logout endpoint, shows a pending state, then routes to the login page', async () => {
    let resolve!: (r: Response) => void;
    fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithIntl(<LogoutButton />, { locale, namespaces: NAMESPACES });

    const button = screen.getByRole('button', { name: msg(locale, 'account.logout') });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(msg(locale, 'account.loggingOut'));

    await act(async () => resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(nav.landed).toEqual([`/${locale}/login`]));
    expect(nav.localeRefresh).toHaveBeenCalled();
  });

  it('still returns to the login page when the session had already ended', async () => {
    fetchMock = respond(401, { error: { code: 'unauthenticated' } });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithIntl(<LogoutButton variant="compact" />, { locale, namespaces: NAMESPACES });

    await user.click(screen.getByRole('button', { name: msg(locale, 'account.logout') }));
    await waitFor(() => expect(nav.landed).toEqual([`/${locale}/login`]));
  });
});

describe('auth UI sources', () => {
  it('use only logical direction classes', () => {
    for (const file of ['LoginForm.tsx', 'LogoutButton.tsx']) {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(findPhysicalDirection(source, file), file).toEqual([]);
    }
  });
});
