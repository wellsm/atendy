import type { Db } from '../../db';
import type { DemoMenuKind } from '../../menu/demo-menus';

import { DatabaseRunner } from '@ez4/local-database/run';

import { DEMO_MENU } from '../../menu/demo-menu';
import { DEMO_MENUS } from '../../menu/demo-menus';
import { MenuRepository } from '../../menu/repository';
import { StoreRepository } from '../../stores/repository';

const { STORE_ID, KIND, REPLACE } = process.env;

if (!STORE_ID) {
  throw new Error('Set STORE_ID');
}

if (KIND && !(KIND in DEMO_MENUS)) {
  throw new Error(`KIND must be one of: ${Object.keys(DEMO_MENUS).join(', ')}`);
}

// Without KIND, the small pizzeria used by tests and evals.
const menu = KIND ? DEMO_MENUS[KIND as DemoMenuKind] : DEMO_MENU;

const db = DatabaseRunner.getClient<Db>('db');

if (!(await StoreRepository.getWebhookSecret(db, STORE_ID))) {
  throw new Error(`Store ${STORE_ID} not found`);
}

if (REPLACE === '1') {
  await MenuRepository.replaceMenu(db, STORE_ID, menu);
} else {
  if ((await MenuRepository.load(db, STORE_ID)).length) {
    throw new Error(`Store ${STORE_ID} already has a menu (REPLACE=1 deletes it first)`);
  }

  await MenuRepository.importMenu(db, STORE_ID, menu);
}

// Open 24h every day so the manual smoke test works at any time.
await StoreRepository.replaceHours(
  db,
  STORE_ID,
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' }))
);

process.stdout.write(`Demo menu ${KIND ?? 'default'} and 24h hours saved for store ${STORE_ID}\n`);
