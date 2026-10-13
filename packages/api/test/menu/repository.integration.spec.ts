import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { MenuRepository } from '../../src/menu/repository';
import { PriceMode } from '../../src/menu/types';
import { productByName, seedMenu, seedStore } from '../support/fixtures';

describe('MenuRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('imports a menu and loads it ordered by category, with groups and options ordered by position', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    deepEqual(
      menu.map(({ category, name }) => `${category}/${name}`),
      ['Pizzas/Pizza Broto', 'Pizzas/Pizza Grande', 'Bebidas/Coca-Cola 2L', 'Bebidas/Guaraná Antarctica 2L']
    );

    const grande = productByName(menu, 'Pizza Grande');

    deepEqual(
      grande.groups.map(({ name, min, max, price_mode }) => [name, min, max, price_mode]),
      [
        ['Sabores', 1, 2, PriceMode.Max],
        ['Borda', 0, 1, PriceMode.Sum]
      ]
    );

    deepEqual(
      grande.groups[0]!.options.map(({ name }) => name),
      ['Calabresa', 'Mussarela', 'Portuguesa', 'Frango com Catupiry']
    );
  });

  it('skips inactive products and keeps inactive options flagged', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    const coca = productByName(menu, 'Coca-Cola 2L');
    const grande = productByName(menu, 'Pizza Grande');
    const mussarela = grande.groups[0]!.options[1]!;

    await db.products.updateMany({ data: { active: false }, where: { id: coca.id } });
    await db.options.updateMany({ data: { active: false }, where: { id: mussarela.id } });

    const reloaded = await MenuRepository.load(db, storeId);

    equal(
      reloaded.some(({ id }) => id === coca.id),
      false
    );
    equal(productByName(reloaded, 'Pizza Grande').groups[0]!.options[1]!.active, false);
  });

  it('returns an empty menu for a store without products', async () => {
    const { storeId } = await seedStore(db);

    deepEqual(await MenuRepository.load(db, storeId), []);
  });
});
