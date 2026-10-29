export type { ApplicationStatus } from '@/platform/config/constants';

export interface ApplicationRow {
  id: string;
  branch_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: import('@/platform/config/constants').ApplicationStatus;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
}
