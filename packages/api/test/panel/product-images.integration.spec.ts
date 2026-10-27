import type { Db } from '../../src/db';
import type { ImageTarget } from '../../src/menu/images';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { stagingKey } from '../../src/menu/images';
import { MenuRepository } from '../../src/menu/repository';
import { completeImageHandler } from '../../src/panel/endpoints/complete-image';
import { deleteMenuGroupHandler } from '../../src/panel/endpoints/delete-group';
import { deleteImageHandler } from '../../src/panel/endpoints/delete-image';
import { deleteProductHandler } from '../../src/panel/endpoints/delete-product';
import { getMenuHandler } from '../../src/panel/endpoints/get-menu';
import { startImageHandler } from '../../src/panel/endpoints/start-image';
import { updateProductHandler } from '../../src/panel/endpoints/update-product';
import { seedMenu, seedStore } from '../support/fixtures';

describe('menu images', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  let staging: { type: string; size: number } | undefined;

  const createBucket = () => ({
    stat: mock.fn((_key: string) => Promise.resolve(staging)),
    copy: mock.fn((_from: string, _to: string) => Promise.resolve()),
    delete: mock.fn((_key: string) => Promise.resolve()),
    getWriteUrl: mock.fn((key: string, _options: object) => Promise.resolve(`http://bucket/${key}?signed`)),
    getReadUrl: mock.fn((key: string, _options: object) => Promise.resolve(`http://bucket/${key}`))
  });

  let bucket = createBucket();
  let productImages = bucket as never;

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const [seeded] = await seedMenu(db, storeId);
    const product = (await MenuRepository.getProduct(db, storeId, seeded!.id))!;

    return {
      storeId,
      productId: product.id,
      optionId: product.groups[0]!.options[0]!.id,
      identity: { userId: 'user_1', orgId }
    };
  };

  const staged = (type: string, size: number) => {
    staging = { type, size };
  };

  const complete = (identity: object, target: ImageTarget, id: string) =>
    completeImageHandler({ identity, parameters: { target, id } } as never, { db, productImages });

  const keys = async (storeId: string, productId: string) => {
    const product = await MenuRepository.getProduct(db, storeId, productId);

    return { product: product?.imageKey ?? null, option: product?.groups[0]?.options[0]?.imageKey ?? null };
  };

  const deleted = () => bucket.delete.mock.calls.map(({ arguments: [key] }) => key);

  beforeEach(() => {
    staging = undefined;
    bucket = createBucket();
    productImages = bucket as never;
  });

  it('signs an upload to the staging key of a store product or option only', async () => {
    const { storeId, productId, optionId, identity } = await setup();

    for (const [target, id] of [
      ['products', productId],
      ['options', optionId]
    ] as const) {
      const { body } = await startImageHandler(
        { identity, parameters: { target, id }, body: { contentType: 'image/webp' } } as never,
        { db, productImages }
      );

      equal(typeof body.uploadUrl, 'string');
      deepEqual(bucket.getWriteUrl.mock.calls.at(-1)?.arguments, [
        stagingKey(storeId, target, id),
        { expiresIn: 300, contentType: 'image/webp' }
      ]);
    }

    const other = await setup();

    for (const [target, id] of [
      ['products', other.productId],
      ['options', other.optionId]
    ] as const) {
      await rejects(
        startImageHandler({ identity, parameters: { target, id }, body: { contentType: 'image/webp' } } as never, {
          db,
          productImages
        }),
        HttpNotFoundError
      );
    }
  });

  it('publishes product and option photos, replaces the previous one and shows them in the menu', async () => {
    const { storeId, productId, optionId, identity } = await setup();

    staged('image/webp', 120_000);

    const first = await complete(identity, 'products', productId);
    const firstKey = (await keys(storeId, productId)).product;

    equal(firstKey?.startsWith(`products/${storeId}/${productId}/`), true);
    equal(first.body.imageUrl?.endsWith(firstKey ?? '-'), true);
    deepEqual(bucket.copy.mock.calls.at(-1)?.arguments, [stagingKey(storeId, 'products', productId), firstKey]);

    await complete(identity, 'products', productId);
    await complete(identity, 'options', optionId);

    const current = await keys(storeId, productId);

    equal(current.product === firstKey, false);
    equal(deleted().includes(firstKey ?? '-'), true);
    equal(current.option?.startsWith(`options/${storeId}/${optionId}/`), true);

    const { body } = await getMenuHandler({ identity } as never, { db, productImages });
    const product = body.categories.flatMap(({ products }) => products).find(({ id }) => id === productId);

    equal(product?.imageUrl?.endsWith(current.product ?? '-'), true);
    equal(product?.groups[0]?.options[0]?.imageUrl?.endsWith(current.option ?? '-'), true);
    equal(product && 'imageKey' in product, false);
  });

  it('refuses a wrong type or an oversized file and drops the staged object', async () => {
    const { storeId, productId, identity } = await setup();

    staged('application/pdf', 1000);
    await rejects(complete(identity, 'products', productId), HttpBadRequestError);

    staged('image/png', 3 * 1024 * 1024);
    await rejects(complete(identity, 'products', productId), HttpBadRequestError);

    equal((await keys(storeId, productId)).product, null);
    equal(bucket.copy.mock.callCount(), 0);
    equal(
      deleted().every((key) => key === stagingKey(storeId, 'products', productId)),
      true
    );
  });

  it('is 404 without an upload', async () => {
    const { productId, identity } = await setup();

    await rejects(complete(identity, 'products', productId), HttpNotFoundError);
  });

  it('removes a photo alone, with its option, or with the whole product', async () => {
    const { storeId, productId, optionId, identity } = await setup();

    staged('image/jpeg', 5000);
    await complete(identity, 'options', optionId);

    const optionKey = (await keys(storeId, productId)).option;

    await deleteImageHandler({ identity, parameters: { target: 'options', id: optionId } } as never, {
      db,
      productImages
    });

    equal((await keys(storeId, productId)).option, null);
    equal(deleted().at(-1), optionKey);

    // A save that drops the option deletes its photo.
    await complete(identity, 'options', optionId);

    const product = (await MenuRepository.getProduct(db, storeId, productId))!;
    const droppedKey = product.groups[0]!.options[0]!.imageKey;
    const [group, ...groups] = product.groups;

    await updateProductHandler(
      {
        identity,
        parameters: { productId },
        body: {
          categoryId: product.categoryId,
          name: product.name,
          description: product.description,
          priceCents: product.priceCents,
          groups: [{ ...group!, options: group!.options.slice(1) }, ...groups]
        }
      } as never,
      { db, productImages }
    );

    equal(deleted().includes(droppedKey ?? '-'), true);

    await complete(identity, 'products', productId);

    const productKey = (await keys(storeId, productId)).product;

    await deleteProductHandler({ identity, parameters: { productId } } as never, { db, productImages });

    equal(deleted().includes(productKey ?? '-'), true);
  });

  it('keeps the photos of a shared group while any product links it', async () => {
    const { storeId, productId, optionId, identity } = await setup();

    staged('image/jpeg', 5000);
    await complete(identity, 'options', optionId);

    const product = (await MenuRepository.getProduct(db, storeId, productId))!;
    const optionKey = product.groups[0]!.options[0]!.imageKey!;

    const { product: other } = await MenuRepository.createProduct(db, storeId, {
      ...product,
      name: 'Outro',
      groups: [product.groups[0]!]
    });

    await deleteProductHandler({ identity, parameters: { productId } } as never, { db, productImages });

    equal(deleted().includes(optionKey), false);
    equal((await keys(storeId, other.id)).option, optionKey);

    await deleteMenuGroupHandler({ identity, parameters: { groupId: product.groups[0]!.id } } as never, {
      db,
      productImages
    });

    equal(deleted().includes(optionKey), true);
    deepEqual((await MenuRepository.getProduct(db, storeId, other.id))!.groups, []);
  });

  it('serves demo photos from the web app and never deletes them from the bucket', async () => {
    const { storeId, identity } = await setup();

    await MenuRepository.replaceMenu(db, storeId, {
      categories: [
        { name: 'Burgers', products: [{ name: 'Classic', price_cents: 2890, image: 'burger/classic.webp' }] }
      ]
    });

    const productId = (await MenuRepository.load(db, storeId))[0]!.id;

    equal((await keys(storeId, productId)).product, 'demo-menu/burger/classic.webp');

    const { body } = await getMenuHandler({ identity } as never, { db, productImages });

    equal(body.categories[0]?.products[0]?.imageUrl, '/demo-menu/burger/classic.webp');

    staged('image/webp', 120_000);
    await complete(identity, 'products', productId);

    equal(deleted().includes('demo-menu/burger/classic.webp'), false);

    await MenuRepository.setImage(db, storeId, productId, 'demo-menu/burger/classic.webp');
    await deleteImageHandler({ identity, parameters: { target: 'products', id: productId } } as never, {
      db,
      productImages
    });

    await MenuRepository.setImage(db, storeId, productId, 'demo-menu/burger/classic.webp');
    await deleteProductHandler({ identity, parameters: { productId } } as never, { db, productImages });

    equal(deleted().includes('demo-menu/burger/classic.webp'), false);
  });
});
