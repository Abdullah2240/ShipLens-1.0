import type { Role } from './roles';

export interface Actor {
  userId: string;
  role: Role;
  branchId: string | null;
  name?: string;
}
