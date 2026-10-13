import { generateKeyPairSync } from 'node:crypto';

import { signJwt } from '@clerk/backend/jwt';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

/**
 * Authorizers read the key at call time; tests verify real RS256 tokens without calling Clerk.
 */
process.env.CLERK_JWT_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/**
 * Returns an `Authorization` header value with a Clerk-like session token (v2 claims by default).
 */
export const signClerkToken = async (claims: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);

  const token = await signJwt({ sub: 'user_test', iat: now, nbf: now, exp: now + 60, v: 2, ...claims }, privatePem, {
    algorithm: 'RS256',
    header: { typ: 'JWT', kid: 'test' }
  });

  return `Bearer ${token}`;
};
