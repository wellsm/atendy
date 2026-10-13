import type { MenuProduct } from './repository';

const STOPWORDS = new Set([
  'com',
  'sem',
  'uma',
  'uns',
  'umas',
  'quero',
  'queria',
  'gostaria',
  'pode',
  'por',
  'favor',
  'pra',
  'para',
  'mais',
  'tem',
  'voce',
  'voces',
  'sim',
  'nao',
  'manda',
  'mandar',
  'ver',
  'duas',
  'dois',
  'tres'
]);

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 */
export const normalizeText = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const words = (value: string) => normalizeText(value).split(' ').filter(Boolean);

/**
 * Prefix match both ways so "pizzas" matches "pizza" and "calab" matches "calabresa".
 */
const hits = (candidates: string[], token: string) => {
  return candidates.some((word) => word.startsWith(token) || (word.length >= 4 && token.startsWith(word)));
};

/**
 * Products whose name/category (2 points per word) or active option names (1 point) match the query words.
 * Used to pick candidates for tools and for Jev questions; the model still decides.
 */
export const searchMenu = (menu: MenuProduct[], query: string, limit = 8) => {
  const tokens = words(query).filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  if (!tokens.length) {
    return [];
  }

  return menu
    .map((product) => {
      const nameWords = words(`${product.name} ${product.category}`);

      const optionWords = words(
        product.groups
          .flatMap(({ options }) => options.filter(({ active }) => active).map(({ name }) => name))
          .join(' ')
      );

      const score = tokens.reduce((total, token) => {
        return total + (hits(nameWords, token) ? 2 : hits(optionWords, token) ? 1 : 0);
      }, 0);

      return { product, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ product }) => product);
};
