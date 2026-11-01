import { z } from 'zod';
import { MEMBER_ROLES, MEMBER_STATUS_VALUES } from './types';

const uuid = z.uuid();
export const memberQuerySchema = z.object({
  q: z.string().optional(),
  teamId: uuid.optional(),
  role: z.enum(MEMBER_ROLES).optional(),
  status: z.enum(MEMBER_STATUS_VALUES).optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});
export type MemberQuery = z.output<typeof memberQuerySchema>;

export function parseMemberQuery(
  params: Record<string, string | string[] | undefined>,
): MemberQuery {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const integer = (key: string, fallback: number) => {
    const value = first(key);
    return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
      ? Number(value)
      : fallback;
  };
  const q = first('q')?.trim().slice(0, 100);
  const teamId = first('teamId');
  const role = first('role');
  const status = first('status');
  return {
    ...(q ? { q } : {}),
    ...(teamId && uuid.safeParse(teamId).success ? { teamId } : {}),
    ...(role && z.enum(MEMBER_ROLES).safeParse(role).success
      ? { role: role as (typeof MEMBER_ROLES)[number] }
      : {}),
    ...(status && z.enum(MEMBER_STATUS_VALUES).safeParse(status).success
      ? { status: status as (typeof MEMBER_STATUS_VALUES)[number] }
      : {}),
    page: Math.max(1, integer('page', 1)),
    pageSize: Math.min(100, Math.max(1, integer('pageSize', 25))),
  };
}

export const memberPatchSchema = z
  .strictObject({
    teamId: uuid.nullable().optional(),
    memberRole: z.enum(MEMBER_ROLES).optional(),
    status: z.enum(MEMBER_STATUS_VALUES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'empty_patch' });
export type MemberPatch = z.output<typeof memberPatchSchema>;

export const teamInputSchema = z.strictObject({
  name: z
    .string({ error: 'required' })
    .trim()
    .min(2, { error: 'too_short' })
    .max(60, { error: 'too_long' }),
  branchId: uuid.optional(),
});
