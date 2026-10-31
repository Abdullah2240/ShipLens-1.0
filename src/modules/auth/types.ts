import { AppError } from '../../platform/errors';
import type { Role } from '../../platform/authz/roles';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  token: string;
  user: SessionUser;
  expiresAt: Date;
}

/**
 * One error for every login failure that is not throttling: unknown email, wrong
 * password and deactivated account all look identical to the caller.
 */
export class InvalidCredentials extends AppError {
  constructor() {
    super(401, 'invalid_credentials', 'Invalid email or password');
  }
}
