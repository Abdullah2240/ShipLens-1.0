'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  LEAD_ROLES,
  type BranchDetail,
  type BranchLead,
  type LeadCandidate,
  type LeadRole,
} from '@/modules/branches/types';
import {
  CheckIcon,
  ErrorNote,
  Panel,
  Spinner,
  errorKey,
  fieldClass,
  primaryButton,
  sendJson,
  type ErrorKey,
} from './form-kit';

/** Wraps text in an LTR isolate (U+2066 ... U+2069) so emails stay intact in Urdu options. */
const ltr = (text: string) => `${String.fromCharCode(0x2066)}${text}${String.fromCharCode(0x2069)}`;

const GROUP_KEY: Record<LeadRole, 'branchLead' | 'hrLead'> = {
  branch_lead: 'branchLead',
  hr_lead: 'hrLead',
};

function leadsFrom(data: unknown): BranchLead[] | null {
  const leads = (data as Partial<BranchDetail> | null)?.leads;
  return Array.isArray(leads) ? leads : null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export interface BranchLeadsPanelProps {
  branchId: string;
  leads: BranchLead[];
  /** Assignable people; loaded by the page only for roles that may assign leads. */
  candidates?: LeadCandidate[];
  canAssign: boolean;
  closed: boolean;
}

export function BranchLeadsPanel({
  branchId,
  leads,
  candidates,
  canAssign,
  closed,
}: BranchLeadsPanelProps) {
  const t = useTranslations('branches');
  const router = useRouter();
  const id = useId();

  const [view, setView] = useState(leads);
  const [previous, setPrevious] = useState(leads);
  if (leads !== previous) {
    setPrevious(leads);
    setView(leads);
  }

  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<'assigned' | ErrorKey | null>(null);
  const inFlight = useRef(false);

  const leadIds = new Set(view.map((lead) => lead.userId));
  const offered = (candidates ?? []).filter(
    (c) => c.branchId !== branchId && !leadIds.has(c.userId),
  );
  const showForm = canAssign && !closed && candidates !== undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFeedback(null);
    const reply = await sendJson('POST', `/api/v1/branches/${branchId}/leads`, {
      userId: selected,
    });
    if (reply.ok) {
      const next = leadsFrom(reply.data);
      if (next) setView(next);
      setSelected('');
      setFeedback('assigned');
      router.refresh();
    } else if (reply.fields.some((f) => f.reason === 'invalid_user')) {
      setFeedback('invalid_user');
    } else {
      setFeedback(errorKey(reply.code));
    }
    setPending(false);
    inFlight.current = false;
  }

  const optionText = (c: LeadCandidate) =>
    [
      c.name,
      ltr(c.email),
      c.branchName
        ? t('leads.candidateCurrentBranch', { branch: c.branchName })
        : t('leads.candidateNoBranch'),
    ].join(' · ');

  return (
    <Panel title={t('leads.title')} id={`${id}-title`}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {LEAD_ROLES.map((role) => {
            const people = view.filter((lead) => lead.role === role);
            const headingId = `${id}-${role}`;
            return (
              <div key={role} className="flex min-w-0 flex-col gap-2.5">
                <h3 id={headingId} className="text-xs font-semibold text-text-muted">
                  {t(`leads.${GROUP_KEY[role]}`)}
                </h3>
                {people.length > 0 ? (
                  <ul aria-labelledby={headingId} className="flex flex-col gap-2">
                    {people.map((lead) => (
                      <li key={lead.userId} className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                        >
                          {initials(lead.name)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-text">
                            {lead.name}
                          </span>
                          <span dir="ltr" className="truncate text-start text-xs text-text-muted">
                            {lead.email}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-muted italic">{t('leads.none')}</p>
                )}
              </div>
            );
          })}
        </div>

        {showForm ? (
          <form
            noValidate
            onSubmit={(e) => void onSubmit(e)}
            className="flex flex-col gap-3 border-t border-border pt-5"
          >
            <label htmlFor={`${id}-candidate`} className="text-sm font-semibold text-text">
              {t('leads.candidate')}
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                id={`${id}-candidate`}
                name="userId"
                value={selected}
                disabled={pending}
                aria-describedby={`${id}-hint ${id}-warning`}
                aria-invalid={feedback === 'invalid_user' || undefined}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setFeedback(null);
                }}
                className={`${fieldClass} h-10 min-w-0 flex-1`}
              >
                <option value="">{t('leads.choose')}</option>
                {LEAD_ROLES.map((role) => {
                  const group = offered.filter((c) => c.role === role);
                  return group.length > 0 ? (
                    <optgroup key={role} label={t(`leads.${GROUP_KEY[role]}`)}>
                      {group.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {optionText(c)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <button type="submit" disabled={!selected || pending} className={primaryButton}>
                {pending ? <Spinner /> : null}
                {pending ? t('leads.assigning') : t('leads.assign')}
              </button>
            </div>
            <p id={`${id}-hint`} className="text-xs text-text-muted">
              {t('leads.assignHint')}
            </p>
            <p
              id={`${id}-warning`}
              className="rounded-lg border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-xs text-tone-warning-fg"
            >
              {t('leads.moveWarning')}
            </p>
            {feedback && feedback !== 'assigned' ? (
              <ErrorNote>{t(`errors.${feedback}`)}</ErrorNote>
            ) : null}
            <p role="status" className="text-sm empty:hidden">
              {feedback === 'assigned' ? (
                <span className="inline-flex items-center gap-2 font-medium text-tone-success-fg">
                  <CheckIcon />
                  {t('leads.assigned')}
                </span>
              ) : null}
            </p>
          </form>
        ) : null}
      </div>
    </Panel>
  );
}
