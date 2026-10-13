import type { Db } from '../../db';

import { DatabaseRunner } from '@ez4/local-database/run';

import { DEFAULT_LLM_MODEL, StoreRepository } from '../../stores/repository';

const { STORE_NAME, STORE_SLUG, STORE_TIMEZONE, STORE_LLM_MODEL = DEFAULT_LLM_MODEL } = process.env;

if (!STORE_NAME || !STORE_SLUG) {
  throw new Error('Set STORE_NAME and STORE_SLUG');
}

const db = DatabaseRunner.getClient<Db>('db');

const store = await StoreRepository.create(db, {
  name: STORE_NAME,
  slug: STORE_SLUG,
  timezone: STORE_TIMEZONE,
  llmModel: STORE_LLM_MODEL,
  active: true
});

process.stdout.write(`${JSON.stringify(store, null, 2)}\n`);
