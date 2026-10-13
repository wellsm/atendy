import { randomBytes } from 'node:crypto';

const SLUG_BASE_MAX_LENGTH = 40;

/**
 * URL-safe slug from a store name plus 4 random hex chars, so two stores with the same name never collide.
 */
export const slugify = (name: string) => {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_BASE_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');

  return `${base || 'loja'}-${randomBytes(2).toString('hex')}`;
};
