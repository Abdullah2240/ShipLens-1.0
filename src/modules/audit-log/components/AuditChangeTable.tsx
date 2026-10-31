import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Bdi, DateText, Ltr, MoneyText } from '@/components/ui';
import { diffSnapshots } from '@/modules/timeline';

export interface AuditChangeTableProps {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const MONEY_FIELDS = new Set(['amount', 'total_amount']);
const MONEY_VALUE = /^-?\d+(?:\.\d{1,2})?$/;
const BUSINESS_DATE_FIELDS = new Set(['collected_on', 'week_start', 'joined_on']);
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_FIELDS = new Set(['routed_at', 'voided_at', 'starts_at', 'ends_at', 'reviewed_at']);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;
// Words people typed: isolated with automatic direction, never forced into LTR.
const TEXT_FIELDS = new Set([
  'purpose',
  'void_reason',
  'return_reason',
  'decision_note',
  'name',
  'city',
  'summary',
  'title',
  'title_en',
  'location',
]);
const MESSAGE_KEY = /^[a-z][a-z0-9_]*$/i;

type Side = 'before' | 'after';

function useValue() {
  const t = useTranslations('audit');
  const tStatus = useTranslations('common.status');

  return function render(field: string, value: unknown): ReactNode {
    if (value === null || value === undefined) {
      return <span className="text-text-muted italic">{t('viewer.diff.empty')}</span>;
    }
    if (typeof value === 'boolean') {
      return <Bdi>{value ? t('timeline.yes') : t('timeline.no')}</Bdi>;
    }
    if (typeof value === 'object') {
      return <Ltr className="font-mono text-[0.92em] break-all">{JSON.stringify(value)}</Ltr>;
    }
    const text = String(value);
    if (MONEY_FIELDS.has(field) && MONEY_VALUE.test(text)) {
      return <MoneyText amount={text} className="font-medium" />;
    }
    if (BUSINESS_DATE_FIELDS.has(field) && BUSINESS_DATE.test(text)) {
      return <DateText value={text} />;
    }
    if (INSTANT_FIELDS.has(field) && ISO_INSTANT.test(text) && !Number.isNaN(Date.parse(text))) {
      return <DateText value={text} withTime />;
    }
    if (field === 'status' && MESSAGE_KEY.test(text) && tStatus.has(text)) {
      return <Bdi>{tStatus(text)}</Bdi>;
    }
    if (field === 'role' && MESSAGE_KEY.test(text) && t.has(`roles.${text}`)) {
      return <Bdi>{t(`roles.${text}`)}</Bdi>;
    }
    if (TEXT_FIELDS.has(field)) return <Bdi className="break-words">{text}</Bdi>;
    const machine = field === 'id' || field.endsWith('_id') || field === 'code';
    return (
      <Ltr className={machine ? 'font-mono text-[0.92em] break-all' : 'tabular break-words'}>
        {text}
      </Ltr>
    );
  };
}

/**
 * Field-by-field before and after for one audit event. Unchanged fields are left out; a
 * creation shows only the new values and a removal only the old ones.
 */
export function AuditChangeTable({ before, after }: AuditChangeTableProps) {
  const t = useTranslations('audit');
  const renderValue = useValue();
  const changes = diffSnapshots(before, after);

  if (changes.length === 0) {
    return <p className="text-sm text-text-muted italic">{t('viewer.diff.none')}</p>;
  }

  const sides: Side[] = [];
  if (before !== null || after === null) sides.push('before');
  if (after !== null) sides.push('after');
  const fieldLabel = (field: string) =>
    MESSAGE_KEY.test(field) && t.has(`fields.${field}`) ? t(`fields.${field}`) : field;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full min-w-[22rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-sunken/60 text-start text-xs text-text-muted">
            <th scope="col" className="w-[32%] px-3 py-2 text-start font-semibold">
              {t('viewer.diff.field')}
            </th>
            {sides.map((side) => (
              <th key={side} scope="col" className="px-3 py-2 text-start font-semibold">
                {t(`viewer.diff.${side}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {changes.map((change) => (
            <tr key={change.field} data-field={change.field} className="align-top">
              <th scope="row" className="px-3 py-2 text-start font-medium text-text-muted">
                {fieldLabel(change.field)}
              </th>
              {sides.map((side) => (
                <td
                  key={side}
                  data-side={side}
                  className={
                    side === 'after'
                      ? 'px-3 py-2 font-medium text-text'
                      : 'px-3 py-2 text-text-muted'
                  }
                >
                  {renderValue(change.field, side === 'before' ? change.before : change.after)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
