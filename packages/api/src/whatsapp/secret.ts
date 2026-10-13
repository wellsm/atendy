import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of the per-store webhook secret.
 */
export const isValidSecret = (expected: string, received: string | undefined) => {
  if (!received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
};
