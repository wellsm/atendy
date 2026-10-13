import type { Db } from '../../src/db';
import type { PanelProductInput } from '../../src/panel/types';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { MenuRepository } from '../../src/menu/repository';
import { PriceMode } from '../../src/menu/types';
import { priceItem } from '../../src/orders/pricing';
import { OrderRepository } from '../../src/orders/repository';
import { createCategoryHandler } from '../../src/panel/endpoints/create-category';
import { createProductHandler } from '../../src/panel/endpoints/create-product';
import { deleteCategoryHandler } from '../../src/panel/endpoints/delete-category';
import { deleteProductHandler } from '../../src/panel/endpoints/delete-product';
import { getMenuHandler } from '../../src/panel/endpoints/get-menu';
import { renameCategoryHandler } from '../../src/panel/endpoints/rename-category';
import { reorderCategoriesHandler } from '../../src/panel/endpoints/reorder-categories';
import { setOptionActiveHandler } from '../../src/panel/endpoints/set-option-active';
import { setProductActiveHandler } from '../../src/panel/endpoints/set-product-active';
import { updateProductHandler } from '../../src/panel/endpoints/update-product';
import { seedConversation, seedStore } from '../support/fixtures';

const pizza = (categoryId: string): PanelProductInput => ({
  categoryId,
  name: 'Pizza Grande',
  description: null,
  priceCents: 0,
  active: true,
  groups: [
    {
      name: 'Sabores',
      min: 1,
      max: 2,
      priceMode: PriceMode.Max,
      options: [
        { name: 'Calabresa', priceDeltaCents: 4990, active: true },
        { name: 'Portuguesa', priceDeltaCents: 5290, active: true }
      ]
    }
  ]
});

describe('panel menu endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const identity = { userId: 'user_1', orgId };

    const {
      body: { category }
    } = await createCategoryHandler({ identity, body: { name: ' Pizzas ' } } as never, { db });

    const {
      body: { product }
    } = await createProductHandler({ identity, body: pizza(category.id) } as never, { db });

    return { storeId, identity, category, product };
  };

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('builds a menu the agent prices, keeping ids across edits', async () => {
    const { storeId, identity, category, product } = await setup();

    equal(category.name, 'Pizzas');

    const menu = await getMenuHandler({ identity } as never, { db });

    deepEqual(menu.body.categories, [{ id: category.id, name: 'Pizzas', products: [product] }]);

    const [flavors] = product.groups;

    const updated = await updateProductHandler(
      {
        identity,
        parameters: { productId: product.id },
        body: { ...product, groups: [{ ...flavors!, options: [...flavors!.options].reverse() }] }
      } as never,
      { db }
    );

    deepEqual(
      updated.body.product.groups[0]!.options.map(({ id }) => id),
      [flavors!.options[1]!.id, flavors!.options[0]!.id]
    );

    const [loaded] = await MenuRepository.load(db, storeId);
    const group = loaded!.groups[0]!;

    equal(
      priceItem(loaded!, [{ group_id: group.id, option_ids: group.options.map(({ id }) => id) }]).unit_price_cents,
      5290
    );
  });

  it('answers 400 with the field to fix', async () => {
    const { identity, category, product } = await setup();
    const foreign = await setup();

    await rejects(createCategoryHandler({ identity, body: { name: ' ' } } as never, { db }), badField('name'));
    await rejects(
      createProductHandler(
        { identity, body: { ...pizza(category.id), groups: [{ ...pizza(category.id).groups[0]!, max: 5 }] } } as never,
        {
          db
        }
      ),
      badField('groups')
    );
    await rejects(
      createProductHandler({ identity, body: pizza(foreign.category.id) } as never, { db }),
      badField('category_id')
    );
    await rejects(
      updateProductHandler(
        {
          identity,
          parameters: { productId: product.id },
          body: { ...product, groups: foreign.product.groups }
        } as never,
        { db }
      ),
      badField('ids')
    );
    await rejects(
      reorderCategoriesHandler({ identity, body: { ids: [foreign.category.id] } } as never, { db }),
      badField('ids')
    );
  });

  it('never reaches the menu of another store', async () => {
    const { identity, product } = await setup();
    const foreign = await setup();
    const optionId = foreign.product.groups[0]!.options[0]!.id;

    const attempts = [
      () =>
        renameCategoryHandler(
          { identity, parameters: { categoryId: foreign.category.id }, body: { name: 'X' } } as never,
          { db }
        ),
      () => deleteCategoryHandler({ identity, parameters: { categoryId: foreign.category.id } } as never, { db }),
      () =>
        updateProductHandler({ identity, parameters: { productId: foreign.product.id }, body: product } as never, {
          db
        }),
      () => deleteProductHandler({ identity, parameters: { productId: foreign.product.id } } as never, { db }),
      () =>
        setProductActiveHandler(
          { identity, parameters: { productId: foreign.product.id }, body: { active: false } } as never,
          { db }
        ),
      () => setOptionActiveHandler({ identity, parameters: { optionId }, body: { active: false } } as never, { db })
    ];

    for (const attempt of attempts) {
      await rejects(attempt(), HttpNotFoundError);
    }

    const menu = await getMenuHandler({ identity: foreign.identity } as never, { db });

    deepEqual(menu.body.categories, [{ id: foreign.category.id, name: 'Pizzas', products: [foreign.product] }]);
  });

  it('refuses to delete a category with products, then deletes it once empty', async () => {
    const { identity, category, product } = await setup();
    const parameters = { categoryId: category.id };

    await rejects(deleteCategoryHandler({ identity, parameters } as never, { db }), HttpConflictError);

    await deleteProductHandler({ identity, parameters: { productId: product.id } } as never, { db });

    equal((await deleteCategoryHandler({ identity, parameters } as never, { db })).body.id, category.id);
    deepEqual((await getMenuHandler({ identity } as never, { db })).body.categories, []);
  });

  it('toggles a product and an option', async () => {
    const { identity, product } = await setup();
    const optionId = product.groups[0]!.options[0]!.id;

    const option = await setOptionActiveHandler(
      { identity, parameters: { optionId }, body: { active: false } } as never,
      { db }
    );

    deepEqual(option.body.option, { id: optionId, active: false });

    const toggled = await setProductActiveHandler(
      { identity, parameters: { productId: product.id }, body: { active: false } } as never,
      { db }
    );

    equal(toggled.body.product.active, false);
    equal(toggled.body.product.groups[0]!.options[0]!.active, false);
  });

  it('renames and reorders categories', async () => {
    const { identity, category } = await setup();

    const {
      body: { category: drinks }
    } = await createCategoryHandler({ identity, body: { name: 'Bebidas' } } as never, { db });

    const renamed = await renameCategoryHandler(
      { identity, parameters: { categoryId: drinks.id }, body: { name: ' Bebidas  geladas ' } } as never,
      { db }
    );

    deepEqual(renamed.body.category, { id: drinks.id, name: 'Bebidas geladas' });

    const reordered = await reorderCategoriesHandler({ identity, body: { ids: [drinks.id, category.id] } } as never, {
      db
    });

    deepEqual(reordered.body.categories, [
      { id: drinks.id, name: 'Bebidas geladas' },
      { id: category.id, name: 'Pizzas' }
    ]);
  });

  it('deleted product leaves order items intact', async () => {
    const { storeId, identity, product } = await setup();
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const [loaded] = await MenuRepository.load(db, storeId);
    const group = loaded!.groups[0]!;

    await OrderRepository.addItem(
      db,
      { storeId, conversationId, customerId },
      { product: loaded!, qty: 1, selections: [{ group_id: group.id, option_ids: [group.options[0]!.id] }] }
    );

    await deleteProductHandler({ identity, parameters: { productId: product.id } } as never, { db });

    const { records } = await db.order_items.findMany({
      select: { product_id: true, product_name: true, unit_price_cents: true, options_snapshot: true },
      where: { store_id: storeId }
    });

    equal(records.length, 1);
    equal(records[0]!.product_name, 'Pizza Grande');
    equal(records[0]!.unit_price_cents, 4990);
    equal(records[0]!.options_snapshot[0]!.options[0]!.name, 'Calabresa');
    deepEqual(await MenuRepository.load(db, storeId), []);
  });
});
