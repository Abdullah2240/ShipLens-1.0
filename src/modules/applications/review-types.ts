import type { ApplicationStatus } from '@/platform/config/constants';

export interface ApplicationListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  branchId: string;
  branchName: string;
  status: ApplicationStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface ApplicationDetail extends ApplicationListItem {
  message: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  memberId: string | null;
  memberCode: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApplicationListQuery {
  status?: ApplicationStatus;
  page: number;
  pageSize: number;
}

export interface AcceptResult {
  applicationId: string;
  memberId: string;
  memberCode: string;
}
