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

    // `fva`: [first factor age, second factor age] in minutes; -1 or absent when unknown.
    const firstFactorAge = Array.isArray(payload.fva) ? payload.fva[0] : undefined;
    const factorAgeMinutes = typeof firstFactorAge === 'number' && firstFactorAge >= 0 ? firstFactorAge : undefined;

    return {
      userId: payload.sub,
      ...(orgId && { orgId }),
      ...(factorAgeMinutes !== undefined && { factorAgeMinutes })
    };
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      return undefined;
    }

    throw error;
  }
};
