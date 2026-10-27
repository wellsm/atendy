import type { ProspectDetails, ProspectSystem } from './types';

import { ProspectSituation, ProspectSystemKind } from './types';
import { normalizePhone, phoneVariants } from '../storefront/web-order';

export const MAX_IMPORT_ROWS = 2000;
export const MAX_MESSAGE_LENGTH = 500;

const MIN_MESSAGES = 2;
const MAX_MESSAGES = 4;
const MAX_TEXT = 120;
const MAX_SYSTEMS = 20;
const MAX_SYSTEM_NAME = 60;
const LINK_PATTERN = /https?:\/\/|www\.|wa\.me/i;

export type ProspectRow = {
  name: string;
  phone: string;
  messages: string[];
  info: Record<string, string | number>;
  details: ProspectDetails;
};

export type ImportRowError = { row: number; reason: string };

export class ProspectImportError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTextList = (value: unknown[]): value is string[] =>
  value.every((item) => typeof item === 'string' && item.trim() !== '');

const SITUATIONS: string[] = [
  ProspectSituation.WhatsApp,
  ProspectSituation.OnlineOrder,
  ProspectSituation.Marketplace,
  ProspectSituation.Competitor,
  ProspectSituation.None
];

const SYSTEM_KINDS: string[] = [
  ProspectSystemKind.Bot,
  ProspectSystemKind.Market,
  ProspectSystemKind.Whats,
  ProspectSystemKind.Other
];

const isBlank = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const TEXT_FIELDS = [
  ['category', 'category', 'Categoria'],
  ['neighborhood', 'neighborhood', 'Bairro'],
  ['zone', 'zone', 'Zona'],
  ['city', 'city', 'Cidade'],
  ['postal_code', 'postalCode', 'CEP'],
  ['site', 'site', 'Site']
] as const;

const parseSystems = (value: unknown): ProspectSystem[] | undefined => {
  if (!Array.isArray(value) || value.length > MAX_SYSTEMS) {
    return undefined;
  }

  const systems: ProspectSystem[] = [];

  for (const item of value) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.kind !== 'string') {
      return undefined;
    }

    const name = item.name.trim();

    if (!name || name.length > MAX_SYSTEM_NAME || !SYSTEM_KINDS.includes(item.kind)) {
      return undefined;
    }

    const system: ProspectSystem = { name, kind: item.kind as ProspectSystemKind };

    if (!isBlank(item.source)) {
      if (typeof item.source !== 'string' || item.source.trim().length > MAX_TEXT) {
        return undefined;
      }

      system.source = item.source.trim();
    }

    systems.push(system);
  }

  return systems;
};

const parseDetails = (raw: Record<string, unknown>): ProspectDetails | string => {
  const details: ProspectDetails = {};

  for (const [key, field, label] of TEXT_FIELDS) {
    const value = raw[key];

    if (isBlank(value)) {
      continue;
    }

    if (typeof value !== 'string' || value.trim().length > MAX_TEXT) {
      return `Campo inválido: ${label}`;
    }

    details[field] = value.trim();
  }

  if (!isBlank(raw.situation)) {
    if (typeof raw.situation !== 'string' || !SITUATIONS.includes(raw.situation)) {
      return 'Situação inválida';
    }

    details.situation = raw.situation as ProspectSituation;
  }

  if (!isBlank(raw.systems)) {
    const systems = parseSystems(raw.systems);

    if (!systems) {
      return 'Sistema inválido';
    }

    details.systems = systems;
  }

  if (!isBlank(raw.rating)) {
    if (typeof raw.rating !== 'number' || !(raw.rating >= 0 && raw.rating <= 5)) {
      return 'Avaliação (rating) deve ser de 0 a 5';
    }

    details.rating = raw.rating;
  }

  if (!isBlank(raw.reviews)) {
    if (typeof raw.reviews !== 'number' || !Number.isInteger(raw.reviews) || raw.reviews < 0) {
      return 'Avaliações (reviews) deve ser um inteiro a partir de 0';
    }

    details.reviews = raw.reviews;
  }

  if (!isBlank(raw.score)) {
    if (typeof raw.score !== 'number' || !Number.isInteger(raw.score) || raw.score < 0 || raw.score > 10) {
      return 'Nota (score) deve ser um inteiro de 0 a 10';
    }

    details.score = raw.score;
  }

  if (!isBlank(raw.mobile)) {
    if (typeof raw.mobile !== 'boolean') {
      return 'Celular (mobile) deve ser verdadeiro ou falso';
    }

    details.mobile = raw.mobile;
  }

  return details;
};

const parseRow = (raw: unknown): ProspectRow | string => {
  if (!isObject(raw)) {
    return 'Linha não é um objeto';
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';

  if (!name) {
    return 'Nome em branco';
  }

  const phone =
    typeof raw.phone === 'string' || typeof raw.phone === 'number' ? normalizePhone(String(raw.phone)) : undefined;

  if (!phone) {
    return 'Telefone inválido';
  }

  const messages: unknown[] = Array.isArray(raw.messages) ? raw.messages : [];

  if (!isTextList(messages) || messages.length < MIN_MESSAGES || messages.length > MAX_MESSAGES) {
    return 'Precisa de 2 a 4 mensagens';
  }

  if (messages.some((message) => message.length > MAX_MESSAGE_LENGTH)) {
    return 'Mensagem com mais de 500 caracteres';
  }

  if (messages.some((message) => LINK_PATTERN.test(message))) {
    return 'Mensagem com link';
  }

  const info: Record<string, string | number> = {};

  if (isObject(raw.info)) {
    for (const [key, value] of Object.entries(raw.info)) {
      if (typeof value === 'string' || typeof value === 'number') {
        info[key] = value;
      }
    }
  }

  const details = parseDetails(raw);

  if (typeof details === 'string') {
    return details;
  }

  return { name, phone, messages, info, details };
};

/**
 * Validates an import file. Bad rows become errors; `duplicates` counts repeated phones inside the file.
 */
export const parseImport = (body: unknown) => {
  if (!isObject(body) || !Array.isArray(body.leads)) {
    throw new ProspectImportError('O arquivo precisa ser um objeto com a lista "leads"');
  }

  if (body.leads.length > MAX_IMPORT_ROWS) {
    throw new ProspectImportError(`O arquivo passa de ${MAX_IMPORT_ROWS} leads`);
  }

  const rows: ProspectRow[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  body.leads.forEach((raw: unknown, index: number) => {
    const parsed = parseRow(raw);

    if (typeof parsed === 'string') {
      errors.push({ row: index + 1, reason: parsed });
      return;
    }

    const variants = phoneVariants(parsed.phone);

    if (variants.some((variant) => seen.has(variant))) {
      duplicates++;
      return;
    }

    variants.forEach((variant) => seen.add(variant));
    rows.push(parsed);
  });

  return { rows, errors, duplicates };
};
