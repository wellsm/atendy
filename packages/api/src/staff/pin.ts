import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;

const derive = (pin: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });

/**
 * `scrypt$<salt>$<hash>` (base64url), a fresh 16-byte salt per call.
 */
export const hashPin = async (pin: string) => {
  const salt = randomBytes(16);
  const key = await derive(pin, salt);

  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
};

export const verifyPin = async (pin: string, hash: string) => {
  const [scheme, salt, key] = hash.split('$');

  if (scheme !== 'scrypt' || !salt || !key) {
    return false;
  }

  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(pin, Buffer.from(salt, 'base64url'));

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
