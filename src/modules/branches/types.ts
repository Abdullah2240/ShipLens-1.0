import type { BranchStatus } from '@/platform/config/constants';

export type { BranchStatus } from '@/platform/config/constants';

export type LeadRole = 'branch_lead' | 'hr_lead';
export const LEAD_ROLES: readonly LeadRole[] = ['branch_lead', 'hr_lead'];

export interface BranchListItem {
  id: string;
  code: string;
  name: string;
  city: string | null;
  status: BranchStatus;
  leadCount: number;
  createdAt: string;
}

export interface BranchLead {
  userId: string;
  name: string;
  email: string;
  role: LeadRole;
}

export interface BranchDetail extends BranchListItem {
  summary: string | null;
  updatedAt: string;
  leads: BranchLead[];
  allowedTransitions: BranchStatus[];
  openReportCount: number;
}

export interface LeadCandidate {
  userId: string;
  name: string;
  email: string;
  role: LeadRole;
  branchId: string | null;
  branchName: string | null;
}
