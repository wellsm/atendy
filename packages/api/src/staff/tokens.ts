import type { Permission } from './permissions';
import type { StaffRole } from './types';

import { createHmac } from 'node:crypto';

import { isValidSecret } from '../whatsapp/secret';

/**
 * Who is using the shared panel. `staffId: null` is the Clerk owner after reverification (`version` 0, `userId` =
 * the reverified Clerk user); otherwise `version` is the employee's `pin_version` when the token was issued. The role
 * here is only informative: `authorize` reads the role from the database.
 */
export type OperatorClaims = {
  storeId: string;
  staffId: string | null;
  userId?: string;
  role: StaffRole;
  version: number;
  expiresAt: number;
};

/**
 * A manager's PIN approval for one permission, sent with the action that needs it.
 */
export type ApprovalClaims = {
  storeId: string;
  staffId: string;
  permission: Permission;
  expiresAt: number;
};

const OPERATOR_TTL_MS = 12 * 60 * 60_000;

const APPROVAL_TTL_MS = 2 * 60_000;

const sign = (value: string) => {
  const secret = process.env.PANEL_OPERATOR_SECRET;

  if (!secret) {
    throw new Error('PANEL_OPERATOR_SECRET is not set');
  }

  return createHmac('sha256', secret).update(value).digest('base64url');
};

/**
 * `<base64url json>.<signature>`; the kind (`op`/`ap`) is signed with the payload, so one never verifies as the other.
 * Stateless: revoked by `pin_version`/`active` checks in `authorize`, not here.
 */
const encode = (kind: string, claims: object) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');

  return `${payload}.${sign(`${kind}:${payload}`)}`;
};

const decode = (kind: string, token: string | undefined) => {
  const [payload, signature, extra] = token?.split('.') ?? [];

  if (!payload || !signature || extra !== undefined || !isValidSecret(sign(`${kind}:${payload}`), signature)) {
    return undefined;
  }

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { expiresAt?: unknown };

  return typeof claims.expiresAt === 'number' && claims.expiresAt > Date.now() ? claims : undefined;
};

export const signOperator = (claims: Omit<OperatorClaims, 'expiresAt'>) =>
  encode('op', { ...claims, expiresAt: Date.now() + OPERATOR_TTL_MS });

export const verifyOperator = (token: string | undefined) => decode('op', token) as OperatorClaims | undefined;

export const signApproval = (claims: Omit<ApprovalClaims, 'expiresAt'>) =>
  encode('ap', { ...claims, expiresAt: Date.now() + APPROVAL_TTL_MS });

export const verifyApproval = (token: string | undefined) => decode('ap', token) as ApprovalClaims | undefined;
