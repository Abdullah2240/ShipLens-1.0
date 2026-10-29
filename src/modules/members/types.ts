import { MEMBER_STATUSES } from '@/platform/config/constants';

export const MEMBER_ROLES = ['volunteer', 'team_lead', 'coordinator', 'mentor'] as const;
export const MEMBER_STATUS_VALUES = MEMBER_STATUSES;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUS_VALUES)[number];

export interface MemberListItem {
  id: string;
  memberCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  teamId: string | null;
  teamName: string | null;
  memberRole: string;
  status: MemberStatus;
  branchId: string;
  branchName: string;
  joinedOn: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TeamItem {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  memberCount: number;
}
