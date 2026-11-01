import { describe, expect, it } from 'vitest';
import { authorize } from '@/platform/authz';
import { buildMemberQuery, MEMBER_SEARCH_EXPR } from './search';

const actor = { userId: 'user', role: 'hr_lead' as const, branchId: 'branch' };

describe('member search SQL', () => {
  it('scopes every query and binds tokens and filters', () => {
    const query = buildMemberQuery(authorize(actor, 'member.read'), {
      q: 'Ali  Khan',
      teamId: 'team',
      role: 'mentor',
      status: 'active',
      page: 2,
      pageSize: 5,
    });
    expect(query.listSql).toContain('m.branch_id = $1');
    expect(query.listSql).toContain(`${MEMBER_SEARCH_EXPR} LIKE $2`);
    expect(query.listSql).toContain('ORDER BY lower(m.full_name), m.id LIMIT $7 OFFSET $8');
    expect(query.countSql).not.toContain('ORDER BY');
    expect(query.countParams).toEqual(['branch', '%ali%', '%khan%', 'team', 'mentor', 'active']);
    expect(query.listParams).toEqual([...query.countParams, 5, 5]);
    expect(query.listSql).not.toContain('Ali');
  });

  it('escapes wildcard characters and supports all scope', () => {
    const query = buildMemberQuery(
      authorize({ userId: 'user', role: 'super_admin', branchId: null }, 'member.read'),
      { q: '%_\\', page: 1, pageSize: 25 },
    );
    expect(query.countSql).toContain('WHERE TRUE');
    expect(query.countParams).toEqual(['%\\%\\_\\\\%']);
  });
});
