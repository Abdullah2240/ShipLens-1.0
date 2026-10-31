import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { countApplications, selectApplicationById, selectApplications } from './repo-review';
import type {
  ApplicationDetail,
  ApplicationListItem,
  ApplicationListQuery,
  Page,
} from './review-types';

export async function listApplications(
  db: Queryable,
  actor: Actor,
  q: ApplicationListQuery,
): Promise<Page<ApplicationListItem>> {
  const scope = authorize(actor, 'application.read');
  const [items, total] = await Promise.all([
    selectApplications(db, scope, q),
    countApplications(db, scope, q),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function getApplication(
  db: Queryable,
  actor: Actor,
  id: string,
): Promise<ApplicationDetail> {
  return selectApplicationById(db, authorize(actor, 'application.read'), id);
}
