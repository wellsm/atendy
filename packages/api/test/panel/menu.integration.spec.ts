import type { Db } from '../../src/db';
import type { PanelProductInput } from '../../src/panel/types';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { BucketTester } from '@ez4/local-storage/test';

import { MenuRepository } from '../../src/menu/repository';
import { PriceMode } from '../../src/menu/types';
import { priceItem } from '../../src/orders/pricing';
import { OrderRepository } from '../../src/orders/repository';
import { applyMenuGroupHandler } from '../../src/panel/endpoints/apply-group';
import { createCategoryHandler } from '../../src/panel/endpoints/create-category';
import { createProductHandler } from '../../src/panel/endpoints/create-product';
import { deleteCategoryHandler } from '../../src/panel/endpoints/delete-category';
import { deleteMenuGroupHandler } from '../../src/panel/endpoints/delete-group';
import { deleteProductHandler } from '../../src/panel/endpoints/delete-product';
import { getMenuHandler } from '../../src/panel/endpoints/get-menu';
import { renameCategoryHandler } from '../../src/panel/endpoints/rename-category';
import { reorderCategoriesHandler } from '../../src/panel/endpoints/reorder-categories';
import { setOptionActiveHandler } from '../../src/panel/endpoints/set-option-active';
import { setProductActiveHandler } from '../../src/panel/endpoints/set-product-active';
import { updateMenuGroupHandler } from '../../src/panel/endpoints/update-group';
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
  const productImages = BucketTester.getClientMock('ProductImages');

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
    } = await createProductHandler({ identity, body: pizza(category.id) } as never, { db, productImages });

    return { storeId, identity, category, product };
  };

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('builds a menu the agent prices, keeping ids across edits', async () => {
    const { storeId, identity, category, product } = await setup();

    equal(category.name, 'Pizzas');

    const menu = await getMenuHandler({ identity } as never, { db, productImages });

    deepEqual(menu.body.categories, [{ id: category.id, name: 'Pizzas', products: [product] }]);

    const [flavors] = product.groups;

    const updated = await updateProductHandler(
      {
        identity,
        parameters: { productId: product.id },
        body: { ...product, groups: [{ ...flavors!, options: [...flavors!.options].reverse() }] }
      } as never,
      { db, productImages }
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
          db,
          productImages
        }
      ),
      badField('groups')
    );
    await rejects(
      createProductHandler({ identity, body: pizza(foreign.category.id) } as never, { db, productImages }),
      badField('category_id')
    );
    await rejects(
      updateProductHandler(
        {
          identity,
          parameters: { productId: product.id },
          body: { ...product, groups: foreign.product.groups }
        } as never,
        { db, productImages }
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
          db,
          productImages
        }),
      () =>
        deleteProductHandler({ identity, parameters: { productId: foreign.product.id } } as never, {
          db,
          productImages
        }),
      () =>
        setProductActiveHandler(
          { identity, parameters: { productId: foreign.product.id }, body: { active: false } } as never,
          { db, productImages }
        ),
      () => setOptionActiveHandler({ identity, parameters: { optionId }, body: { active: false } } as never, { db })
    ];

    for (const attempt of attempts) {
      await rejects(attempt(), HttpNotFoundError);
    }

    const menu = await getMenuHandler({ identity: foreign.identity } as never, { db, productImages });

    deepEqual(menu.body.categories, [{ id: foreign.category.id, name: 'Pizzas', products: [foreign.product] }]);
  });

  it('refuses to delete a category with products, then deletes it once empty', async () => {
    const { identity, category, product } = await setup();
    const parameters = { categoryId: category.id };

    await rejects(deleteCategoryHandler({ identity, parameters } as never, { db }), HttpConflictError);

    await deleteProductHandler({ identity, parameters: { productId: product.id } } as never, { db, productImages });

    equal((await deleteCategoryHandler({ identity, parameters } as never, { db })).body.id, category.id);
    deepEqual((await getMenuHandler({ identity } as never, { db, productImages })).body.categories, []);
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
      { db, productImages }
    );

    equal(toggled.body.product.active, false);
    equal(toggled.body.product.groups[0]!.options[0]!.active, false);
  });

  it('links a group to many products, skipping repeats and full products', async () => {
    const { identity, category, product } = await setup();
    const source = product.groups[0]!;

    await setOptionActiveHandler(
      { identity, parameters: { optionId: source.options[0]!.id }, body: { active: false } } as never,
      { db }
    );

    const create = async (input: Partial<PanelProductInput>) => {
      const body = { ...pizza(category.id), groups: [], ...input };
      const { body: created } = await createProductHandler({ identity, body } as never, { db, productImages });

      return created.product;
    };

    const soda = await create({ name: 'Refrigerante', priceCents: 690 });
    const sweet = await create({
      name: 'Pizza Doce',
      groups: [{ ...pizza(category.id).groups[0]!, name: ' sabores ' }]
    });
    const full = await create({
      name: 'Cheio',
      groups: Array.from({ length: 10 }, (_, index) => ({
        name: `Grupo ${index}`,
        min: 0,
        max: 1,
        priceMode: PriceMode.Sum,
        options: [{ name: 'Único', priceDeltaCents: 0 }]
      }))
    });

    const apply = (productIds: string[], max = 1) =>
      applyMenuGroupHandler(
        { identity, parameters: { groupId: source.id }, body: { productIds, min: 1, max } } as never,
        { db }
      );

    await rejects(apply([soda.id], 3), badField('groups'));

    const result = await apply([product.id, soda.id, sweet.id, full.id]);

    deepEqual(result.body, { applied: [soda.id], alreadyHad: [product.id, sweet.id], full: [full.id] });

    const menu = await getMenuHandler({ identity } as never, { db, productImages });
    const groupsOf = (id: string) => menu.body.categories[0]!.products.find((candidate) => candidate.id === id)!.groups;
    const linked = groupsOf(soda.id);

    // The same group, sold-out toggle included; only the limits are soda's own.
    equal(linked.length, 1);
    deepEqual(linked[0]!.options, groupsOf(product.id)[0]!.options);
    deepEqual([linked[0]!.id, linked[0]!.priceMode, linked[0]!.min, linked[0]!.max], [source.id, PriceMode.Max, 1, 1]);
    equal(groupsOf(product.id)[0]!.max, 2);
    equal(linked[0]!.options[0]!.active, false);

    deepEqual((await apply([soda.id])).body, { applied: [], alreadyHad: [soda.id], full: [] });
  });

  it('applies only the store own group to its own products', async () => {
    const { identity, product } = await setup();
    const foreign = await setup();

    const apply = (groupId: string, productIds: string[]) =>
      applyMenuGroupHandler({ identity, parameters: { groupId }, body: { productIds, min: 0, max: 1 } } as never, {
        db
      });

    await rejects(apply(foreign.product.groups[0]!.id, [product.id]), HttpNotFoundError);
    await rejects(apply(product.groups[0]!.id, [foreign.product.id]), badField('product_ids'));
    await rejects(apply(product.groups[0]!.id, [product.id, product.id]), badField('product_ids'));

    equal(await db.product_groups.count({ where: { product_id: foreign.product.id } }), 1);
    equal(await db.product_groups.count({ where: { product_id: product.id } }), 1);
  });

  it('edits a group for every product from the library', async () => {
    const { identity, category, product } = await setup();
    const source = product.groups[0]!;

    await createProductHandler(
      { identity, body: { ...pizza(category.id), name: 'Pizza Broto', groups: [{ ...source, max: 1 }] } } as never,
      { db, productImages }
    );

    const update = (groupId: string, body: object) =>
      updateMenuGroupHandler({ identity, parameters: { groupId }, body } as never, { db, productImages });

    const { body } = await update(source.id, {
      name: 'Sabores',
      priceMode: PriceMode.Max,
      options: [...source.options, { name: 'Atum', priceDeltaCents: 5590 }]
    });

    deepEqual(
      body.group.options.map(({ name, imageUrl }) => [name, imageUrl]),
      [
        ['Calabresa', null],
        ['Portuguesa', null],
        ['Atum', null]
      ]
    );

    // Pizza Grande chooses up to 2 flavors.
    await rejects(update(source.id, { ...body.group, options: [body.group.options[0]] }), badField('shared_groups'));

    const menu = await getMenuHandler({ identity } as never, { db, productImages });

    deepEqual(
      menu.body.categories[0]!.products.map(({ name, groups }) => [name, groups[0]!.options.length, groups[0]!.max]),
      [
        ['Pizza Broto', 3, 1],
        ['Pizza Grande', 3, 2]
      ]
    );

    const foreign = await setup();
    const foreignGroup = { groupId: foreign.product.groups[0]!.id };

    await rejects(update(foreignGroup.groupId, body.group), HttpNotFoundError);
    await rejects(
      deleteMenuGroupHandler({ identity, parameters: foreignGroup } as never, { db, productImages }),
      HttpNotFoundError
    );
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

    await deleteProductHandler({ identity, parameters: { productId: product.id } } as never, { db, productImages });

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
