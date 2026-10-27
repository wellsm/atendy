import type { Db } from '../../src/db';
import type { ProductDraft } from '../../src/menu/validation';

import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { DeleteCategoryResult, MenuRepository } from '../../src/menu/repository';
import { PriceMode } from '../../src/menu/types';
import { MAX_CATEGORIES, MenuError } from '../../src/menu/validation';
import { priceItem } from '../../src/orders/pricing';
import { seedStore } from '../support/fixtures';

const failsOn = (field: string) => (error: unknown) => error instanceof MenuError && error.field === field;

const pizzaDraft = (categoryId: string): ProductDraft => ({
  categoryId,
  name: 'Pizza Grande',
  description: '8 fatias',
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
        { name: 'Mussarela', priceDeltaCents: 4590, active: true },
        { name: 'Portuguesa', priceDeltaCents: 5290, active: true }
      ]
    },
    {
      name: 'Borda',
      min: 0,
      max: 1,
      priceMode: PriceMode.Sum,
      options: [{ name: 'Catupiry', priceDeltaCents: 1000, active: true }]
    }
  ]
});

describe('MenuRepository (panel)', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const { storeId } = await seedStore(db);
    const category = await MenuRepository.createCategory(db, storeId, 'Pizzas');
    const { product } = await MenuRepository.createProduct(db, storeId, pizzaDraft(category.id));

    return { storeId, category, product };
  };

  it('creates a product the agent prices', async () => {
    const { storeId, category, product } = await setup();

    const [panel] = await MenuRepository.loadPanel(db, storeId);

    equal(panel?.id, category.id);
    deepEqual(panel?.products, [product]);
    deepEqual(
      product.groups.map(({ name }) => name),
      ['Sabores', 'Borda']
    );

    const [loaded] = await MenuRepository.load(db, storeId);
    const [flavors, border] = loaded!.groups;
    const option = (name: string) => flavors!.options.find((candidate) => candidate.name === name)!.id;

    const { unit_price_cents } = priceItem(loaded!, [
      { group_id: flavors!.id, option_ids: [option('Calabresa'), option('Portuguesa')] },
      { group_id: border!.id, option_ids: [border!.options[0]!.id] }
    ]);

    equal(unit_price_cents, 6290);
  });

  it('replaces a product keeping the ids it was sent', async () => {
    const { storeId, product } = await setup();
    const [flavors, border] = product.groups;
    const [calabresa, mussarela, portuguesa] = flavors!.options;

    const { product: replaced } = (await MenuRepository.replaceProduct(db, storeId, product.id, {
      ...product,
      name: 'Pizza Grande (8 fatias)',
      groups: [
        { ...border! },
        {
          ...flavors!,
          options: [
            { ...portuguesa! },
            { ...calabresa!, name: 'Calabresa Especial' },
            { name: 'Atum', priceDeltaCents: 5590, active: true }
          ]
        }
      ]
    }))!;

    ok(replaced);
    equal(replaced.name, 'Pizza Grande (8 fatias)');
    deepEqual(
      replaced.groups.map(({ id }) => id),
      [border!.id, flavors!.id]
    );

    const options = replaced.groups[1]!.options;

    deepEqual(
      options.map(({ name }) => name),
      ['Portuguesa', 'Calabresa Especial', 'Atum']
    );
    equal(options[0]!.id, portuguesa!.id);
    equal(options[1]!.id, calabresa!.id);
    ok(![calabresa!.id, mussarela!.id, portuguesa!.id].includes(options[2]!.id));

    const removed = await db.options.findOne({ select: { id: true }, where: { id: mussarela!.id } });

    equal(removed, undefined);
  });

  it('drops groups missing from the replacement with their options', async () => {
    const { storeId, product } = await setup();
    const [flavors, border] = product.groups;

    await MenuRepository.replaceProduct(db, storeId, product.id, { ...product, groups: [{ ...flavors! }] });

    const [group, option] = await Promise.all([
      db.option_groups.findOne({ select: { id: true }, where: { id: border!.id } }),
      db.options.findOne({ select: { id: true }, where: { id: border!.options[0]!.id } })
    ]);

    equal(group, undefined);
    equal(option, undefined);
  });

  it('rejects ids that do not belong to the product group', async () => {
    const { storeId, category, product } = await setup();
    const { product: other } = await MenuRepository.createProduct(db, storeId, {
      ...pizzaDraft(category.id),
      name: 'Pizza Broto'
    });
    const foreign = await setup();
    const [flavors, border] = product.groups;

    const attempts: ProductDraft[] = [
      // Option of another product.
      { ...product, groups: [{ ...flavors!, options: [{ ...other.groups[0]!.options[0]! }], min: 1, max: 1 }] },
      // Group of another store.
      { ...product, groups: [{ ...foreign.product.groups[0]! }] },
      // Option moved to the other group of the same product.
      { ...product, groups: [{ ...flavors! }, { ...border!, options: [{ ...flavors!.options[0]! }] }] }
    ];

    for (const attempt of attempts) {
      await rejects(MenuRepository.replaceProduct(db, storeId, product.id, attempt), failsOn('ids'));
    }

    deepEqual(await MenuRepository.getProduct(db, storeId, product.id), product);
  });

  it('rejects ids of another store on create', async () => {
    const { storeId, category } = await setup();
    const foreign = await setup();

    await rejects(
      MenuRepository.createProduct(db, storeId, {
        ...pizzaDraft(category.id),
        groups: [{ ...foreign.product.groups[0]! }]
      }),
      failsOn('ids')
    );
  });

  it('keeps the old product when the replacement fails midway', async () => {
    const { storeId, product } = await setup();
    const [flavors, border] = product.groups;

    await rejects(
      MenuRepository.replaceProduct(db, storeId, product.id, {
        ...product,
        name: 'Changed',
        groups: [
          { ...flavors!, name: 'Changed' },
          // NOT NULL: the database refuses it after the first writes.
          { ...border!, options: [{ ...border!.options[0]!, name: null as never }] }
        ]
      })
    );

    deepEqual(await MenuRepository.getProduct(db, storeId, product.id), product);
  });

  it('refuses a category of another store', async () => {
    const { storeId, product } = await setup();
    const foreign = await setup();

    await rejects(MenuRepository.createProduct(db, storeId, pizzaDraft(foreign.category.id)), failsOn('category_id'));
    await rejects(
      MenuRepository.replaceProduct(db, storeId, product.id, { ...product, categoryId: foreign.category.id }),
      failsOn('category_id')
    );
  });

  it('does not touch a product of another store', async () => {
    const { storeId, product } = await setup();
    const foreign = await setup();

    equal(await MenuRepository.replaceProduct(db, storeId, foreign.product.id, product), undefined);
    equal(await MenuRepository.getProduct(db, storeId, foreign.product.id), undefined);
    equal(await MenuRepository.setProductActive(db, storeId, foreign.product.id, false), false);
    equal(await MenuRepository.setOptionActive(db, storeId, foreign.product.groups[0]!.options[0]!.id, false), false);
    equal(await MenuRepository.deleteProduct(db, storeId, foreign.product.id), undefined);
    equal(await MenuRepository.renameCategory(db, storeId, foreign.category.id, 'X'), false);
    equal(await MenuRepository.deleteCategory(db, storeId, foreign.category.id), DeleteCategoryResult.NotFound);

    deepEqual(await MenuRepository.getProduct(db, foreign.storeId, foreign.product.id), foreign.product);
  });

  it('toggles products and options for the agent only', async () => {
    const { storeId, product } = await setup();
    const calabresa = product.groups[0]!.options[0]!;

    equal(await MenuRepository.setOptionActive(db, storeId, calabresa.id, false), true);

    const [loaded] = await MenuRepository.load(db, storeId);

    equal(loaded!.groups[0]!.options[0]!.active, false);

    equal(await MenuRepository.setProductActive(db, storeId, product.id, false), true);
    deepEqual(await MenuRepository.load(db, storeId), []);

    const panel = await MenuRepository.getProduct(db, storeId, product.id);

    equal(panel?.active, false);
    equal(panel?.groups[0]!.options[0]!.active, false);
  });

  it('keeps sold-out toggles made while the product form was open', async () => {
    const { storeId, product } = await setup();
    const [calabresa, mussarela] = product.groups[0]!.options;

    await MenuRepository.setOptionActive(db, storeId, calabresa!.id, false);
    await MenuRepository.setProductActive(db, storeId, product.id, false);

    // The form loaded everything active and only changed Mussarela's price; it omits untouched active flags.
    const { active: _product, ...draft } = product;
    const [flavors, border] = product.groups;

    const replaced = (
      await MenuRepository.replaceProduct(db, storeId, product.id, {
        ...draft,
        groups: [
          {
            ...flavors!,
            options: flavors!.options.map(({ active: _option, ...option }) =>
              option.id === mussarela!.id ? { ...option, priceDeltaCents: 4690 } : option
            )
          },
          { ...border!, options: [...border!.options, { name: 'Cheddar', priceDeltaCents: 1000 }] }
        ]
      })
    )?.product;

    equal(replaced?.active, false);
    equal(replaced?.groups[0]!.options[0]!.active, false);
    equal(replaced?.groups[0].options[1]!.priceDeltaCents, 4690);
    equal(replaced?.groups[1]!.options[1]!.active, true);
  });

  it('deletes a product with its groups and options', async () => {
    const { storeId, product } = await setup();

    deepEqual(await MenuRepository.deleteProduct(db, storeId, product.id), []);
    equal(await MenuRepository.getProduct(db, storeId, product.id), undefined);

    const { records } = await db.options.findMany({
      select: { id: true },
      where: { group_id: { isIn: product.groups.map(({ id }) => id) } }
    });

    deepEqual(records, []);
  });

  it('shares a group between products: options everywhere, limits per product', async () => {
    const { storeId, category, product: grande } = await setup();
    const [flavors] = grande.groups;
    const [calabresa, mussarela, portuguesa] = flavors!.options;

    // Broto links the same "Sabores" with one flavor and a new Calabresa price.
    const { product: broto } = await MenuRepository.createProduct(db, storeId, {
      ...pizzaDraft(category.id),
      name: 'Pizza Broto',
      groups: [
        {
          ...flavors!,
          min: 1,
          max: 1,
          options: [{ ...calabresa!, priceDeltaCents: 3990 }, { ...mussarela! }, { ...portuguesa! }]
        }
      ]
    });

    equal(broto.groups[0]!.id, flavors!.id);
    equal(await db.option_groups.count({ where: { store_id: storeId } }), 2);

    await MenuRepository.setOptionActive(db, storeId, mussarela!.id, false);

    const both = await MenuRepository.loadPanel(db, storeId);
    const shared = (name: string) => both[0]!.products.find((product) => product.name === name)!.groups[0]!;

    deepEqual([shared('Pizza Grande').max, shared('Pizza Broto').max], [2, 1]);
    deepEqual(shared('Pizza Grande').options, shared('Pizza Broto').options);
    equal(shared('Pizza Grande').options[0]!.priceDeltaCents, 3990);
    equal(shared('Pizza Grande').options[1]!.active, false);

    // Grande chooses up to 2: Broto may not leave the shared group with a single flavor.
    await rejects(
      MenuRepository.replaceProduct(db, storeId, broto.id, {
        ...broto,
        groups: [{ ...broto.groups[0]!, options: [{ ...calabresa! }] }]
      }),
      failsOn('shared_groups')
    );

    // Unlinking keeps the group for Grande; deleting Grande then deletes it.
    await MenuRepository.replaceProduct(db, storeId, broto.id, { ...broto, groups: [] });
    equal((await MenuRepository.getProduct(db, storeId, grande.id))!.groups[0]!.id, flavors!.id);

    await MenuRepository.deleteProduct(db, storeId, grande.id);

    equal(await db.option_groups.count({ where: { store_id: storeId } }), 0);
    equal(await db.options.count({ where: { store_id: storeId } }), 0);
    equal(await db.product_groups.count({ where: { store_id: storeId } }), 0);
  });

  it('edits and deletes a shared group from the library', async () => {
    const { storeId, category, product: grande } = await setup();
    const [flavors] = grande.groups;
    const { product: broto } = await MenuRepository.createProduct(db, storeId, {
      ...pizzaDraft(category.id),
      name: 'Pizza Broto',
      groups: [{ ...flavors!, min: 1, max: 1 }]
    });

    const [calabresa, mussarela] = flavors!.options;

    // Grande allows 2 flavors: the library may not leave one.
    await rejects(
      MenuRepository.updateGroup(db, storeId, flavors!.id, { ...flavors!, options: [{ ...calabresa! }] }),
      failsOn('shared_groups')
    );

    const updated = await MenuRepository.updateGroup(db, storeId, flavors!.id, {
      name: 'Sabores da casa',
      priceMode: PriceMode.Sum,
      options: [{ ...mussarela! }, { ...calabresa! }]
    });

    deepEqual(updated?.droppedImageKeys, []);
    deepEqual(
      updated?.group.options.map(({ id }) => id),
      [mussarela!.id, calabresa!.id]
    );
    // Default limits shrink to fit the 2 options left.
    deepEqual([updated?.group.min, updated?.group.max], [1, 1]);

    for (const id of [grande.id, broto.id]) {
      const group = (await MenuRepository.getProduct(db, storeId, id))!.groups[0]!;

      deepEqual([group.name, group.priceMode, group.options.length], ['Sabores da casa', PriceMode.Sum, 2]);
    }

    const foreign = await setup();

    equal(await MenuRepository.updateGroup(db, storeId, foreign.product.groups[0]!.id, flavors!), undefined);
    equal(await MenuRepository.deleteGroup(db, storeId, foreign.product.groups[0]!.id), undefined);

    deepEqual(await MenuRepository.deleteGroup(db, storeId, flavors!.id), []);

    for (const id of [grande.id, broto.id]) {
      deepEqual(
        (await MenuRepository.getProduct(db, storeId, id))!.groups.map(({ name }) => name),
        id === grande.id ? ['Borda'] : []
      );
    }

    equal(await db.options.count({ where: { group_id: flavors!.id } }), 0);
  });

  it('imports equal groups once, linked with each product limits', async () => {
    const { storeId } = await seedStore(db);
    const drinks = (max: number) => ({
      name: 'Bebida',
      min: 0,
      max,
      price_mode: PriceMode.Sum,
      options: [
        { name: 'Coca', price_delta_cents: 690 },
        { name: 'Guaraná', price_delta_cents: 590 }
      ]
    });

    await MenuRepository.importMenu(db, storeId, {
      categories: [
        {
          name: 'Pratos',
          products: [
            { name: 'Yakisoba', price_cents: 3990, groups: [drinks(2)] },
            { name: 'Poke', price_cents: 4590, groups: [drinks(1)] }
          ]
        }
      ]
    });

    const [poke, yakisoba] = await MenuRepository.load(db, storeId);

    equal(await db.option_groups.count({ where: { store_id: storeId } }), 1);
    equal(poke!.groups[0]!.id, yakisoba!.groups[0]!.id);
    deepEqual([poke!.groups[0]!.max, yakisoba!.groups[0]!.max], [1, 2]);
  });

  it('orders, renames and deletes categories', async () => {
    const { storeId, category } = await setup();
    const drinks = await MenuRepository.createCategory(db, storeId, 'Bebidas');
    const desserts = await MenuRepository.createCategory(db, storeId, 'Sobremesas');

    deepEqual(
      (await MenuRepository.loadPanel(db, storeId)).map(({ name }) => name),
      ['Pizzas', 'Bebidas', 'Sobremesas']
    );

    await MenuRepository.reorderCategories(db, storeId, [desserts.id, category.id, drinks.id]);
    equal(await MenuRepository.renameCategory(db, storeId, drinks.id, 'Bebidas geladas'), true);

    deepEqual(
      (await MenuRepository.loadPanel(db, storeId)).map(({ name }) => name),
      ['Sobremesas', 'Pizzas', 'Bebidas geladas']
    );

    equal(await MenuRepository.deleteCategory(db, storeId, category.id), DeleteCategoryResult.NotEmpty);
    equal(await MenuRepository.deleteCategory(db, storeId, desserts.id), DeleteCategoryResult.Deleted);

    deepEqual(
      (await MenuRepository.loadPanel(db, storeId)).map(({ name }) => name),
      ['Pizzas', 'Bebidas geladas']
    );
  });

  it('refuses a reorder that is not exactly the store categories', async () => {
    const { storeId, category } = await setup();
    const drinks = await MenuRepository.createCategory(db, storeId, 'Bebidas');
    const foreign = await setup();

    for (const ids of [
      [category.id],
      [category.id, drinks.id, foreign.category.id],
      [category.id, category.id],
      [category.id, foreign.category.id]
    ]) {
      await rejects(MenuRepository.reorderCategories(db, storeId, ids), failsOn('ids'));
    }

    deepEqual(
      (await MenuRepository.loadPanel(db, storeId)).map(({ id }) => id),
      [category.id, drinks.id]
    );
  });

  it('caps the number of categories', async () => {
    const { storeId } = await seedStore(db);

    for (let index = 0; index < MAX_CATEGORIES; index++) {
      await MenuRepository.createCategory(db, storeId, `C${index}`);
    }

    await rejects(MenuRepository.createCategory(db, storeId, 'Extra'), failsOn('categories'));
  });

  it('stamps updated_at on replace', async () => {
    const { storeId, product } = await setup();
    const before = await db.products.findOne({ select: { updated_at: true }, where: { id: product.id } });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await MenuRepository.replaceProduct(db, storeId, product.id, { ...product, priceCents: 100 });

    const after = await db.products.findOne({ select: { updated_at: true }, where: { id: product.id } });

    notEqual(after?.updated_at, before?.updated_at);
  });
});
