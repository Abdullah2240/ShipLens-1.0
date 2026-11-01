'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bdi } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { isBranchReadOnly } from '@/modules/branches/capabilities';
import { branchPatchSchema } from '@/modules/branches/schema';
import type { BranchDetail } from '@/modules/branches/types';
import { BranchCode, BranchDate } from './BranchesTable';
import {
  CheckIcon,
  ErrorNote,
  Fact,
  InfoNote,
  Panel,
  Spinner,
  errorKey,
  fieldClass,
  primaryButton,
  sendJson,
  type ErrorKey,
} from './form-kit';

type Field = 'name' | 'city' | 'summary';
type Values = Record<Field, string>;
type Patch = { name?: string; city?: string | null; summary?: string | null };
type FieldErrors = Partial<Record<Field, ErrorKey>>;

const FIELDS: readonly Field[] = ['name', 'city', 'summary'];
const isField = (value: unknown): value is Field => FIELDS.includes(value as Field);

const valuesOf = (branch: BranchDetail): Values => ({
  name: branch.name,
  city: branch.city ?? '',
  summary: branch.summary ?? '',
});

/** Only the fields that differ from the saved branch; empty optional text clears it. */
function changes(base: Values, next: Values): Patch {
  const patch: Patch = {};
  const name = next.name.trim();
  if (name !== base.name) patch.name = name;
  const city = next.city.trim();
  if (city !== base.city) patch.city = city || null;
  const summary = next.summary.trim();
  if (summary !== base.summary) patch.summary = summary || null;
  return patch;
}

function validate(patch: Patch): FieldErrors {
  const parsed = branchPatchSchema.safeParse(patch);
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (isField(field) && !errors[field]) errors[field] = errorKey(issue.message);
  }
  return errors;
}

function detailFrom(data: unknown): BranchDetail | null {
  return data && typeof data === 'object' && 'code' in data && 'leads' in data
    ? (data as BranchDetail)
    : null;
}

export interface BranchDetailsFormProps {
  branch: BranchDetail;
  canEdit: boolean;
}

export function BranchDetailsForm({ branch, canEdit }: BranchDetailsFormProps) {
  const t = useTranslations('branches');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();

  // `view` is the latest server state: the prop after a refresh, or the reply of a save.
  const [view, setView] = useState(branch);
  const [previous, setPrevious] = useState(branch);
  const [values, setValues] = useState(() => valuesOf(branch));
  if (branch !== previous) {
    setPrevious(branch);
    setView(branch);
    setValues(valuesOf(branch));
  }

  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ErrorKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const patch = changes(valuesOf(view), values);
  const dirty = Object.keys(patch).length > 0;
  const closed = isBranchReadOnly(view.status);
  const editable = canEdit && !closed;

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    setSaved(false);
    setFailure(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || inFlight.current) return;
    setFailure(null);
    setSaved(false);
    const found = validate(patch);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      if (found.name) nameRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setErrors({});
    const reply = await sendJson('PATCH', `/api/v1/branches/${view.id}`, patch);
    if (reply.ok) {
      const next = detailFrom(reply.data) ?? {
        ...view,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.city !== undefined ? { city: patch.city } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      };
      setView(next);
      setValues(valuesOf(next));
      setSaved(true);
      router.refresh();
    } else if (reply.code === 'duplicate_branch_name') {
      setErrors({ name: 'duplicate_branch_name' });
      nameRef.current?.focus();
    } else if (reply.code === 'branch_closed') {
      setFailure('branch_closed');
      router.refresh();
    } else if (reply.status === 422 && reply.fields.some((f) => isField(f.path))) {
      const next: FieldErrors = {};
      for (const issue of reply.fields) {
        if (isField(issue.path) && !next[issue.path]) next[issue.path] = issue.reason;
      }
      setErrors(next);
    } else {
      setFailure(errorKey(reply.code));
    }
    setPending(false);
    inFlight.current = false;
  }

  const notSet = <span className="text-text-muted">{t('detail.notSet')}</span>;

  const codeFact = (
    <Fact label={t('detail.code')}>
      <span className="flex flex-col items-start gap-1">
        <BranchCode code={view.code} />
        <span className="text-xs text-text-muted">{t('detail.codeHint')}</span>
      </span>
    </Fact>
  );
  const dates = (
    <>
      <Fact label={t('detail.created')}>
        <BranchDate value={view.createdAt} locale={locale} />
      </Fact>
      <Fact label={t('detail.updated')}>
        <BranchDate value={view.updatedAt} locale={locale} />
      </Fact>
    </>
  );

  if (!editable) {
    return (
      <Panel title={t('detail.details')} id={`${id}-title`}>
        <div className="flex flex-col gap-5">
          {!canEdit ? <InfoNote>{t('detail.readOnlyNotice')}</InfoNote> : null}
          {closed ? <InfoNote>{t('detail.closedNotice')}</InfoNote> : null}
          <dl className="grid gap-5 sm:grid-cols-2">
            <Fact label={t('create.name')}>
              <Bdi>{view.name}</Bdi>
            </Fact>
            <Fact label={t('create.city')}>
              {view.city === null ? notSet : <Bdi>{view.city}</Bdi>}
            </Fact>
            {codeFact}
            {dates}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="text-xs font-semibold text-text-muted">{t('detail.summary')}</dt>
              <dd className="text-sm leading-relaxed whitespace-pre-line text-text">
                {view.summary === null ? (
                  <span className="text-text-muted italic">{t('detail.noSummary')}</span>
                ) : (
                  <Bdi>{view.summary}</Bdi>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </Panel>
    );
  }

  const describedBy = (field: Field) => (errors[field] ? `${id}-${field}-error` : undefined);
  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="text-xs font-medium text-tone-danger-fg">
        {t(`errors.${errors[field]}`)}
      </p>
    ) : null;

  return (
    <Panel title={t('detail.details')} id={`${id}-title`}>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
        <dl className="grid gap-5 rounded-lg bg-surface-sunken/60 p-4 sm:grid-cols-3">
          {codeFact}
          {dates}
        </dl>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-semibold text-text">
              {t('create.name')}
            </label>
            <input
              ref={nameRef}
              id={`${id}-name`}
              name="name"
              type="text"
              required
              maxLength={80}
              autoComplete="off"
              dir="auto"
              value={values.name}
              disabled={pending}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy('name')}
              onChange={(e) => update('name', e.target.value)}
              className={`${fieldClass} h-10`}
            />
            {fieldError('name')}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-city`} className="text-sm font-semibold text-text">
              {t('create.city')}
            </label>
            <input
              id={`${id}-city`}
              name="city"
              type="text"
              maxLength={60}
              autoComplete="off"
              dir="auto"
              value={values.city}
              disabled={pending}
              aria-invalid={errors.city ? true : undefined}
              aria-describedby={describedBy('city')}
              onChange={(e) => update('city', e.target.value)}
              className={`${fieldClass} h-10`}
            />
            {fieldError('city')}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-summary`} className="text-sm font-semibold text-text">
            {t('detail.summary')}
          </label>
          <textarea
            id={`${id}-summary`}
            name="summary"
            rows={4}
            maxLength={500}
            dir="auto"
            value={values.summary}
            disabled={pending}
            aria-invalid={errors.summary ? true : undefined}
            aria-describedby={describedBy('summary')}
            onChange={(e) => update('summary', e.target.value)}
            className={`${fieldClass} py-2 leading-relaxed`}
          />
          {fieldError('summary')}
        </div>

        {failure ? <ErrorNote>{t(`errors.${failure}`)}</ErrorNote> : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p role="status" className="text-sm text-text-muted">
            {dirty ? (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-full bg-tone-warning-fg" />
                {t('edit.unsaved')}
              </span>
            ) : saved ? (
              <span className="inline-flex items-center gap-2 font-medium text-tone-success-fg">
                <CheckIcon />
                {t('edit.saved')}
              </span>
            ) : (
              t('edit.noChanges')
            )}
          </p>
          <button type="submit" disabled={!dirty || pending} className={primaryButton}>
            {pending ? <Spinner /> : null}
            {pending ? t('edit.saving') : t('edit.save')}
          </button>
        </div>
      </form>
    </Panel>
  );
}
