import type { PanelIdentity } from './types';

import { verifyToken } from '@clerk/backend';
import { TokenVerificationError } from '@clerk/backend/errors';

const getOrgId = (claim: unknown) => {
  if (claim && typeof claim === 'object' && 'id' in claim && typeof claim.id === 'string' && claim.id) {
    return claim.id;
  }

  return undefined;
};

/**
 * Verifies a Clerk session token from an `Authorization: Bearer` header without a network call
 * (`CLERK_JWT_KEY` is the instance PEM public key). Returns `undefined` for any invalid token.
 */
export const verifyClerkToken = async (authorization: string | undefined): Promise<PanelIdentity | undefined> => {
  const [scheme, token] = authorization?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    return undefined;
  }

  try {
    const payload = await verifyToken(token, { jwtKey: process.env.CLERK_JWT_KEY });

    if (!payload.sub) {
      return undefined;
    }

    // Session token v2 carries the active org in `o.id`; v1 in `org_id`.
    const orgId = getOrgId(payload.o) ?? getOrgId({ id: payload.org_id });

    return orgId ? { userId: payload.sub, orgId } : { userId: payload.sub };
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      return undefined;
    }

    throw error;
  }
};
