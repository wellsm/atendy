import type { Db } from '../../db';

import { DatabaseRunner } from '@ez4/local-database/run';

import { DEMO_MENU } from '../../menu/demo-menu';
import { MenuRepository } from '../../menu/repository';
import { StoreRepository } from '../../stores/repository';

const { STORE_ID } = process.env;

if (!STORE_ID) {
  throw new Error('Set STORE_ID');
}

const db = DatabaseRunner.getClient<Db>('db');

if (!(await StoreRepository.getWebhookSecret(db, STORE_ID))) {
  throw new Error(`Store ${STORE_ID} not found`);
}

if ((await MenuRepository.load(db, STORE_ID)).length) {
  throw new Error(`Store ${STORE_ID} already has a menu`);
}

await MenuRepository.importMenu(db, STORE_ID, DEMO_MENU);

// Open 24h every day so the manual smoke test works at any time.
await StoreRepository.replaceHours(
  db,
  STORE_ID,
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' }))
);

process.stdout.write(`Demo menu and 24h hours saved for store ${STORE_ID}\n`);
