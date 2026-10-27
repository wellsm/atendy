import type { DbClient } from '../db';
import type { PriceMode } from './types';
import type { GroupContentDraft, GroupDraft, OptionDraft, ProductDraft } from './validation';
import type { PricingProduct } from '../orders/pricing';

import { randomUUID } from 'node:crypto';

import { DEMO_IMAGE_PREFIX, isBucketImage } from './images';
import { normalizeText } from './search';
import { MAX_CATEGORIES, MAX_GROUPS, MenuError, validateLimits } from './validation';
import { StockRepository } from '../stock/repository';

export type PanelMenuOption = Required<Omit<OptionDraft, 'id'>> & {
  id: string;
  /**
   * Computed from stock (`StockRepository.availability`), never stored.
   */
  soldOut: boolean;
  /**
   * Bucket key; endpoints turn it into a signed `imageUrl` (`withImageUrl`).
   */
  imageKey: string | null;
};

export type PanelMenuGroup = Omit<GroupDraft, 'id' | 'options'> & {
  id: string;
  options: PanelMenuOption[];
};

export type PanelMenuProduct = Omit<ProductDraft, 'active' | 'groups'> & {
  id: string;
  soldOut: boolean;
  active: boolean;
  /**
   * Bucket key; endpoints turn it into a signed `imageUrl` (`withImageUrl`).
   */
  imageKey: string | null;
  groups: PanelMenuGroup[];
};

export type PanelMenuCategory = {
  id: string;
  name: string;
  products: PanelMenuProduct[];
};

export const enum DeleteCategoryResult {
  Deleted = 'deleted',
  NotFound = 'not_found',
  NotEmpty = 'not_empty'
}

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  description?: string | null;
  price_cents: number;
  active: boolean;
  image_key?: string | null;
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

type OptionRow = {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  active: boolean;
  image_key?: string | null;
  position: number;
};

/**
 * The groups of each given product, through its links: name, price mode and options (every one, in position order)
 * come from the shared group; `min`, `max` and the order from the product's link.
 */
const loadGroups = async (db: DbClient, productIds: string[]) => {
  const { records: links } = await db.product_groups.findMany({
    select: { product_id: true, group_id: true, min: true, max: true, position: true },
    where: { product_id: { isIn: productIds } }
  });

  const groupIds = [...new Set(links.map(({ group_id }) => group_id))];

  const [{ records: groups }, { records: options }] = groupIds.length
    ? await Promise.all([
        db.option_groups.findMany({
          select: { id: true, name: true, price_mode: true },
          where: { id: { isIn: groupIds } }
        }),
        db.options.findMany({
          select: {
            id: true,
            group_id: true,
            name: true,
            price_delta_cents: true,
            active: true,
            image_key: true,
            position: true
          },
          where: { group_id: { isIn: groupIds } }
        })
      ])
    : [{ records: [] }, { records: [] }];

  return (productId: string) =>
    links
      .filter(({ product_id }) => product_id === productId)
      .sort(byPosition)
      .flatMap((link) => {
        const group = groups.find(({ id }) => id === link.group_id);

        return group
          ? [
              {
                id: group.id,
                name: group.name,
                min: link.min,
                max: link.max,
                price_mode: group.price_mode,
                options: options.filter(({ group_id }) => group_id === group.id).sort(byPosition)
              }
            ]
          : [];
      });
};

const toPanelOption = (
  { id, name, price_delta_cents, active, image_key }: OptionRow,
  soldOut: Set<string>
): PanelMenuOption => ({
  id,
  soldOut: soldOut.has(id),
  name,
  priceDeltaCents: price_delta_cents,
  active,
  imageKey: image_key ?? null
});

/**
 * Panel shape of the given products, with every group and option (active or not) in position order.
 */
const mapProducts = async (db: DbClient, storeId: string, products: ProductRow[]): Promise<PanelMenuProduct[]> => {
  if (!products.length) {
    return [];
  }

  const { soldOutProducts, soldOutOptions } = await StockRepository.availability(db, storeId);

  const groupsOf = await loadGroups(
    db,
    products.map(({ id }) => id)
  );

  return [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      description: product.description ?? null,
      priceCents: product.price_cents,
      active: product.active,
      soldOut: soldOutProducts.has(product.id),
      imageKey: product.image_key ?? null,
      groups: groupsOf(product.id).map((group) => ({
        id: group.id,
        name: group.name,
        min: group.min,
        max: group.max,
        priceMode: group.price_mode,
        options: group.options.map((option) => toPanelOption(option, soldOutOptions))
      }))
    }));
};

const PRODUCT_FIELDS = {
  id: true,
  store_id: true,
  category_id: true,
  name: true,
  description: true,
  price_cents: true,
  active: true,
  image_key: true
} as const;

const findStoreProduct = async (db: DbClient, storeId: string, productId: string) => {
  const product = await db.products.findOne({ select: PRODUCT_FIELDS, where: { id: productId } });

  return product?.store_id === storeId ? product : undefined;
};

const findStoreCategory = async (db: DbClient, storeId: string, categoryId: string) => {
  const category = await db.categories.findOne({
    select: { id: true, store_id: true, name: true },
    where: { id: categoryId }
  });

  return category?.store_id === storeId ? category : undefined;
};

const assertStoreCategory = async (db: DbClient, storeId: string, categoryId: string) => {
  if (!(await findStoreCategory(db, storeId, categoryId))) {
    throw new MenuError('category_id', 'Unknown category.');
  }
};

type StoredOption = { id: string; group_id: string; image_key?: string | null };

/**
 * Every sent option id must already belong to its group (a new group sends none).
 */
const assertOwnOptions = (groupId: string | undefined, options: OptionDraft[], stored: StoredOption[]) => {
  for (const option of options) {
    const current = stored.find(({ id }) => id === option.id);

    if (option.id !== undefined && (groupId === undefined || current?.group_id !== groupId)) {
      throw new MenuError('ids', 'Unknown option.');
    }
  }
};

/**
 * A shared group may not end up with fewer options than the `max` another product chose for it.
 */
const assertSharedLimits = async (db: DbClient, groups: { id?: string; options: unknown[] }[], productId?: string) => {
  const ids = groups.flatMap(({ id }) => (id === undefined ? [] : [id]));

  if (!ids.length) {
    return;
  }

  const { records: links } = await db.product_groups.findMany({
    select: { product_id: true, group_id: true, max: true },
    where: { group_id: { isIn: ids } }
  });

  for (const group of groups) {
    const below = links.some(
      (link) => link.group_id === group.id && link.product_id !== productId && link.max > group.options.length
    );

    if (below) {
      throw new MenuError('shared_groups', "A shared group would have fewer options than another product's maximum.");
    }
  }
};

/**
 * Sent option ids are updated in place, the rest is created, and the group's current options missing from `options`
 * are deleted. Returns the photo keys of the deleted ones.
 */
const writeOptions = async (
  db: DbClient,
  storeId: string,
  groupId: string,
  options: OptionDraft[],
  stored: StoredOption[]
) => {
  const kept = new Set(options.map(({ id }) => id));
  const dropped = stored.filter((option) => option.group_id === groupId && !kept.has(option.id));

  if (dropped.length) {
    await db.stock_links.deleteMany({ where: { option_id: { isIn: dropped.map(({ id }) => id) } } });
    await db.options.deleteMany({ where: { id: { isIn: dropped.map(({ id }) => id) } } });
  }

  for (const [position, option] of options.entries()) {
    const optionData = {
      name: option.name,
      price_delta_cents: option.priceDeltaCents,
      position
    };

    if (option.id === undefined) {
      await db.options.insertOne({
        data: { id: randomUUID(), store_id: storeId, group_id: groupId, ...optionData, active: option.active ?? true }
      });
    } else {
      await db.options.updateOne({
        data: { ...optionData, ...(option.active !== undefined && { active: option.active }) },
        where: { id: option.id }
      });
    }
  }

  return dropped.map(({ image_key }) => image_key ?? null);
};

/**
 * Deletes, with their options, the given groups no product links anymore. Returns the options' photo keys.
 */
const deleteOrphanGroups = async (db: DbClient, groupIds: string[]) => {
  if (!groupIds.length) {
    return [];
  }

  const { records: links } = await db.product_groups.findMany({
    select: { group_id: true },
    where: { group_id: { isIn: groupIds } }
  });

  const orphans = groupIds.filter((id) => !links.some(({ group_id }) => group_id === id));

  if (!orphans.length) {
    return [];
  }

  const { records: options } = await db.options.findMany({
    select: { id: true, image_key: true },
    where: { group_id: { isIn: orphans } }
  });

  await db.stock_links.deleteMany({ where: { option_id: { isIn: options.map(({ id }) => id) } } });
  await db.options.deleteMany({ where: { group_id: { isIn: orphans } } });
  await db.option_groups.deleteMany({ where: { id: { isIn: orphans } } });

  return options.map(({ image_key }) => image_key ?? null);
};

/**
 * Writes the groups of a product. A sent group id may be any group of the store: the product links it, and its shared
 * part (name, price mode, options) changes for every product linked; no id creates a group. `min`/`max` go to this
 * product's link (and become the group's default). Groups the product no longer sends are unlinked, and deleted when
 * no product links them anymore. Every sent option id must belong to its group; the checks run before any write.
 * Returns the photo keys of the deleted options.
 */
const writeGroups = async (db: DbClient, storeId: string, productId: string, groups: GroupDraft[]) => {
  const sentIds = groups.flatMap(({ id }) => (id === undefined ? [] : [id]));

  const { records: storeGroups } = sentIds.length
    ? await db.option_groups.findMany({ select: { id: true }, where: { id: { isIn: sentIds }, store_id: storeId } })
    : { records: [] };

  if (storeGroups.length !== sentIds.length) {
    throw new MenuError('ids', 'Unknown group.');
  }

  const { records: stored } = sentIds.length
    ? await db.options.findMany({
        select: { id: true, group_id: true, image_key: true },
        where: { group_id: { isIn: sentIds } }
      })
    : { records: [] };

  for (const group of groups) {
    assertOwnOptions(group.id, group.options, stored);
  }

  await assertSharedLimits(db, groups, productId);

  const { records: links } = await db.product_groups.findMany({
    select: { id: true, group_id: true },
    where: { product_id: productId }
  });

  const unlinked = links.filter(({ group_id }) => !sentIds.includes(group_id));

  if (unlinked.length) {
    await db.product_groups.deleteMany({ where: { id: { isIn: unlinked.map(({ id }) => id) } } });
  }

  const droppedKeys: (string | null)[] = [];

  for (const [position, group] of groups.entries()) {
    const groupId = group.id ?? randomUUID();
    const groupData = { name: group.name, min: group.min, max: group.max, price_mode: group.priceMode };
    const linkData = { min: group.min, max: group.max, position };
    const link = links.find(({ group_id }) => group_id === groupId);

    if (group.id === undefined) {
      await db.option_groups.insertOne({ data: { id: groupId, store_id: storeId, ...groupData } });
    } else {
      await db.option_groups.updateOne({ data: groupData, where: { id: groupId } });
    }

    if (link) {
      await db.product_groups.updateOne({ data: linkData, where: { id: link.id } });
    } else {
      await db.product_groups.insertOne({
        data: { id: randomUUID(), store_id: storeId, product_id: productId, group_id: groupId, ...linkData }
      });
    }

    droppedKeys.push(...(await writeOptions(db, storeId, groupId, group.options, stored)));
  }

  droppedKeys.push(
    ...(await deleteOrphanGroups(
      db,
      unlinked.map(({ group_id }) => group_id)
    ))
  );

  return droppedKeys.filter(isBucketImage);
};

/**
 * Product ids by outcome of `applyGroup`.
 */
export type ApplyGroupResult = {
  applied: string[];
  alreadyHad: string[];
  full: string[];
};

export type MenuProduct = PricingProduct & {
  category_id: string;
  category: string;
  description: string | null;
};

export type MenuImport = {
  categories: {
    name: string;
    products: {
      name: string;
      description?: string;
      price_cents: number;
      /** Demo photo under `packages/web/public/demo-menu/` (e.g. `burger/x-bacon.webp`), saved as a `demo-menu/` key. */
      image?: string;
      groups?: {
        name: string;
        min: number;
        max: number;
        price_mode: PriceMode;
        options: { name: string; price_delta_cents: number }[];
      }[];
    }[];
  }[];
};

export namespace MenuRepository {
  export const load = async (db: DbClient, storeId: string): Promise<MenuProduct[]> => {
    const [{ records: categories }, { records: products }] = await Promise.all([
      db.categories.findMany({
        select: { id: true, name: true, position: true },
        where: { store_id: storeId }
      }),
      db.products.findMany({
        select: { id: true, category_id: true, name: true, description: true, price_cents: true, active: true },
        where: { store_id: storeId, active: true }
      })
    ]);

    if (!products.length) {
      return [];
    }

    const [groupsOf, { soldOutProducts, soldOutOptions }] = await Promise.all([
      loadGroups(
        db,
        products.map(({ id }) => id)
      ),
      StockRepository.availability(db, storeId)
    ]);

    const categoryOf = new Map(categories.map((category) => [category.id, category]));

    const categoryPosition = (categoryId: string) => categoryOf.get(categoryId)?.position ?? Number.MAX_SAFE_INTEGER;

    return [...products]
      .sort((a, b) => categoryPosition(a.category_id) - categoryPosition(b.category_id) || a.name.localeCompare(b.name))
      .map((product) => ({
        id: product.id,
        name: product.name,
        category_id: product.category_id,
        category: categoryOf.get(product.category_id)?.name ?? '',
        description: product.description ?? null,
        price_cents: product.price_cents,
        active: product.active,
        sold_out: soldOutProducts.has(product.id),
        groups: groupsOf(product.id).map((group) => ({
          ...group,
          options: group.options.map(({ id, name, price_delta_cents, active }) => ({
            id,
            name,
            price_delta_cents,
            active,
            sold_out: soldOutOptions.has(id)
          }))
        }))
      }));
  };

  /**
   * Inserts the whole menu as active items. Used by the demo seed and tests; the store panel saves product by product.
   * Groups with the same name, price mode and options are one shared group, linked with each product's limits.
   */
  export const importMenu = async (db: DbClient, storeId: string, menu: MenuImport) => {
    const now = new Date().toISOString();
    const sharedGroups = new Map<string, string>();

    for (const [categoryPosition, category] of menu.categories.entries()) {
      const categoryId = randomUUID();

      await db.categories.insertOne({
        data: { id: categoryId, store_id: storeId, name: category.name, position: categoryPosition }
      });

      for (const product of category.products) {
        const productId = randomUUID();

        await db.products.insertOne({
          data: {
            id: productId,
            store_id: storeId,
            category_id: categoryId,
            name: product.name,
            description: product.description ?? null,
            price_cents: product.price_cents,
            image_key: product.image ? `${DEMO_IMAGE_PREFIX}${product.image}` : null,
            active: true,
            created_at: now,
            updated_at: now
          }
        });

        for (const [position, group] of (product.groups ?? []).entries()) {
          const key = JSON.stringify([group.name, group.price_mode, group.options]);
          const sharedId = sharedGroups.get(key);
          const groupId = sharedId ?? randomUUID();

          if (!sharedId) {
            sharedGroups.set(key, groupId);

            await db.option_groups.insertOne({
              data: {
                id: groupId,
                store_id: storeId,
                name: group.name,
                min: group.min,
                max: group.max,
                price_mode: group.price_mode
              }
            });

            for (const [optionPosition, option] of group.options.entries()) {
              await db.options.insertOne({
                data: {
                  id: randomUUID(),
                  store_id: storeId,
                  group_id: groupId,
                  name: option.name,
                  price_delta_cents: option.price_delta_cents,
                  active: true,
                  position: optionPosition
                }
              });
            }
          }

          await db.product_groups.insertOne({
            data: {
              id: randomUUID(),
              store_id: storeId,
              product_id: productId,
              group_id: groupId,
              min: group.min,
              max: group.max,
              position
            }
          });
        }
      }
    }
  };

  /**
   * Deletes the store's whole menu and imports `menu` in one transaction. Past orders keep their item snapshots.
   */
  export const replaceMenu = async (db: DbClient, storeId: string, menu: MenuImport) => {
    await db.transaction(async (tx) => {
      await tx.stock_links.deleteMany({ where: { store_id: storeId } });
      await tx.options.deleteMany({ where: { store_id: storeId } });
      await tx.product_groups.deleteMany({ where: { store_id: storeId } });
      await tx.option_groups.deleteMany({ where: { store_id: storeId } });
      await tx.products.deleteMany({ where: { store_id: storeId } });
      await tx.categories.deleteMany({ where: { store_id: storeId } });

      await importMenu(tx, storeId, menu);
    });
  };

  /**
   * Whole menu for the panel: categories by position, products by name, inactive items included.
   */
  export const loadPanel = async (db: DbClient, storeId: string): Promise<PanelMenuCategory[]> => {
    const [{ records: categories }, { records: products }] = await Promise.all([
      db.categories.findMany({ select: { id: true, name: true, position: true }, where: { store_id: storeId } }),
      db.products.findMany({ select: PRODUCT_FIELDS, where: { store_id: storeId } })
    ]);

    const panelProducts = await mapProducts(db, storeId, products);

    return [...categories].sort(byPosition).map(({ id, name }) => ({
      id,
      name,
      products: panelProducts.filter(({ categoryId }) => categoryId === id)
    }));
  };

  export const getProduct = async (db: DbClient, storeId: string, productId: string) => {
    const product = await findStoreProduct(db, storeId, productId);

    if (!product) {
      return undefined;
    }

    const [panelProduct] = await mapProducts(db, storeId, [product]);

    return panelProduct;
  };

  /**
   * A group's shared part in the panel shape, with its default limits.
   */
  export const getGroup = async (
    db: DbClient,
    storeId: string,
    groupId: string
  ): Promise<PanelMenuGroup | undefined> => {
    const group = await db.option_groups.findOne({
      select: { store_id: true, name: true, min: true, max: true, price_mode: true },
      where: { id: groupId }
    });

    if (group?.store_id !== storeId) {
      return undefined;
    }

    const { records: options } = await db.options.findMany({
      select: {
        id: true,
        group_id: true,
        name: true,
        price_delta_cents: true,
        active: true,
        image_key: true,
        position: true
      },
      where: { group_id: groupId }
    });

    const { soldOutOptions } = await StockRepository.availability(db, storeId);

    return {
      id: groupId,
      name: group.name,
      min: group.min,
      max: group.max,
      priceMode: group.price_mode,
      options: [...options].sort(byPosition).map((option) => toPanelOption(option, soldOutOptions))
    };
  };

  /**
   * New category at the end of the list.
   */
  export const createCategory = async (db: DbClient, storeId: string, name: string) => {
    const { records } = await db.categories.findMany({ select: { position: true }, where: { store_id: storeId } });

    if (records.length >= MAX_CATEGORIES) {
      throw new MenuError('categories', `At most ${MAX_CATEGORIES} categories.`);
    }

    const id = randomUUID();
    const position = Math.max(-1, ...records.map((record) => record.position)) + 1;

    await db.categories.insertOne({ data: { id, store_id: storeId, name, position } });

    return { id, name };
  };

  export const renameCategory = async (db: DbClient, storeId: string, categoryId: string, name: string) => {
    const updated = await db.categories.updateMany({
      select: { id: true },
      data: { name },
      where: { id: categoryId, store_id: storeId }
    });

    return updated.length > 0;
  };

  /**
   * `ids` must be exactly the store categories, in the new order.
   */
  export const reorderCategories = async (db: DbClient, storeId: string, ids: string[]) => {
    const { records } = await db.categories.findMany({ select: { id: true }, where: { store_id: storeId } });
    const storeIds = new Set(records.map(({ id }) => id));

    if (new Set(ids).size !== ids.length || ids.length !== storeIds.size || !ids.every((id) => storeIds.has(id))) {
      throw new MenuError('ids', 'Send every category exactly once.');
    }

    await db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx.categories.updateOne({ data: { position }, where: { id } });
      }
    });
  };

  export const deleteCategory = async (db: DbClient, storeId: string, categoryId: string) => {
    if (!(await findStoreCategory(db, storeId, categoryId))) {
      return DeleteCategoryResult.NotFound;
    }

    if (await db.products.count({ where: { category_id: categoryId } })) {
      return DeleteCategoryResult.NotEmpty;
    }

    await db.categories.deleteOne({ where: { id: categoryId } });

    return DeleteCategoryResult.Deleted;
  };

  /**
   * Product with its groups and options, in one transaction (see `writeGroups`). Also returns the photo keys of the
   * options it deleted from shared groups.
   */
  export const createProduct = async (db: DbClient, storeId: string, draft: ProductDraft) => {
    await assertStoreCategory(db, storeId, draft.categoryId);

    const productId = randomUUID();
    const now = new Date().toISOString();

    let droppedImageKeys: string[] = [];

    await db.transaction(async (tx) => {
      await tx.products.insertOne({
        data: {
          id: productId,
          store_id: storeId,
          category_id: draft.categoryId,
          name: draft.name,
          description: draft.description,
          price_cents: draft.priceCents,
          active: draft.active ?? true,
          created_at: now,
          updated_at: now
        }
      });

      droppedImageKeys = await writeGroups(tx, storeId, productId, draft.groups);
    });

    return { product: (await getProduct(db, storeId, productId))!, droppedImageKeys };
  };

  /**
   * Replaces the product, its groups and options in one transaction, keeping the ids it was sent (see `writeGroups`).
   * Also returns the photo keys of the options it deleted. Returns undefined when the product is not this store's.
   */
  export const replaceProduct = async (db: DbClient, storeId: string, productId: string, draft: ProductDraft) => {
    if (!(await findStoreProduct(db, storeId, productId))) {
      return undefined;
    }

    await assertStoreCategory(db, storeId, draft.categoryId);

    let droppedImageKeys: string[] = [];

    await db.transaction(async (tx) => {
      await tx.products.updateOne({
        data: {
          category_id: draft.categoryId,
          name: draft.name,
          description: draft.description,
          price_cents: draft.priceCents,
          ...(draft.active !== undefined && { active: draft.active }),
          updated_at: new Date().toISOString()
        },
        where: { id: productId }
      });

      droppedImageKeys = await writeGroups(tx, storeId, productId, draft.groups);
    });

    return { product: (await getProduct(db, storeId, productId))!, droppedImageKeys };
  };

  /**
   * Links a group to the end of each product with the given limits, in one transaction. Products already linked to it,
   * with another group of the same name or with no room left are skipped, so applying twice never duplicates. Returns
   * undefined when the group is not the store's.
   */
  export const applyGroup = async (
    db: DbClient,
    storeId: string,
    groupId: string,
    productIds: string[],
    limits: { min: number; max: number }
  ) => {
    const source = await db.option_groups.findOne({ select: { store_id: true, name: true }, where: { id: groupId } });

    if (source?.store_id !== storeId) {
      return undefined;
    }

    const { records: products } = await db.products.findMany({
      select: { id: true },
      where: { id: { isIn: productIds }, store_id: storeId }
    });

    if (new Set(productIds).size !== productIds.length || products.length !== productIds.length) {
      throw new MenuError('product_ids', 'Unknown or repeated product.');
    }

    validateLimits(source.name, limits.min, limits.max, await db.options.count({ where: { group_id: groupId } }));

    const { records: links } = await db.product_groups.findMany({
      select: { product_id: true, group_id: true, position: true },
      where: { product_id: { isIn: productIds } }
    });

    const linkedIds = [...new Set(links.map(({ group_id }) => group_id))];

    const { records: linkedGroups } = linkedIds.length
      ? await db.option_groups.findMany({ select: { id: true, name: true }, where: { id: { isIn: linkedIds } } })
      : { records: [] };

    const nameOf = new Map(linkedGroups.map(({ id, name }) => [id, normalizeText(name)]));
    const name = normalizeText(source.name);
    const result: ApplyGroupResult = { applied: [], alreadyHad: [], full: [] };

    await db.transaction(async (tx) => {
      for (const productId of productIds) {
        const current = links.filter(({ product_id }) => product_id === productId);

        if (current.some((link) => link.group_id === groupId || nameOf.get(link.group_id) === name)) {
          result.alreadyHad.push(productId);
          continue;
        }

        if (current.length >= MAX_GROUPS) {
          result.full.push(productId);
          continue;
        }

        await tx.product_groups.insertOne({
          data: {
            id: randomUUID(),
            store_id: storeId,
            product_id: productId,
            group_id: groupId,
            min: limits.min,
            max: limits.max,
            position: Math.max(-1, ...current.map(({ position }) => position)) + 1
          }
        });

        result.applied.push(productId);
      }
    });

    return result;
  };

  /**
   * Replaces a group's shared part (name, price mode, options) for every product linked to it, in one transaction.
   * Returns undefined when the group is not the store's, else the group and the photo keys of the options it deleted.
   */
  export const updateGroup = async (db: DbClient, storeId: string, groupId: string, content: GroupContentDraft) => {
    const group = await db.option_groups.findOne({
      select: { store_id: true, min: true, max: true },
      where: { id: groupId }
    });

    if (group?.store_id !== storeId) {
      return undefined;
    }

    const { records: stored } = await db.options.findMany({
      select: { id: true, group_id: true, image_key: true },
      where: { group_id: groupId }
    });

    assertOwnOptions(groupId, content.options, stored);

    await assertSharedLimits(db, [{ id: groupId, options: content.options }]);

    // The default limits must still fit for the next product linked.
    const max = Math.min(group.max, content.options.length);

    let droppedImageKeys: string[] = [];

    await db.transaction(async (tx) => {
      await tx.option_groups.updateOne({
        data: { name: content.name, price_mode: content.priceMode, max, min: Math.min(group.min, max) },
        where: { id: groupId }
      });

      droppedImageKeys = (await writeOptions(tx, storeId, groupId, content.options, stored)).filter(isBucketImage);
    });

    return { group: (await getGroup(db, storeId, groupId))!, droppedImageKeys };
  };

  /**
   * Removes a group from every product and deletes it with its options, in one transaction. Returns undefined when the
   * group is not the store's, else its options' photo keys.
   */
  export const deleteGroup = async (db: DbClient, storeId: string, groupId: string) => {
    const group = await db.option_groups.findOne({ select: { store_id: true }, where: { id: groupId } });

    if (group?.store_id !== storeId) {
      return undefined;
    }

    let imageKeys: string[] = [];

    await db.transaction(async (tx) => {
      await tx.product_groups.deleteMany({ where: { group_id: groupId } });

      imageKeys = (await deleteOrphanGroups(tx, [groupId])).filter(isBucketImage);
    });

    return imageKeys;
  };

  /**
   * Replaces the product photo; returns the previous key (to delete its object), or undefined when the product is not
   * the store's.
   */
  export const setImage = async (db: DbClient, storeId: string, productId: string, imageKey: string | null) => {
    const product = await findStoreProduct(db, storeId, productId);

    if (!product) {
      return undefined;
    }

    await db.products.updateOne({
      data: { image_key: imageKey, updated_at: new Date().toISOString() },
      where: { id: productId }
    });

    return { previousKey: product.image_key ?? null };
  };

  /**
   * Deletes the product, its links and the groups no other product links. Returns undefined when the product is not the
   * store's, else the photo keys it held alone (its own and those of the deleted options).
   */
  export const deleteProduct = async (db: DbClient, storeId: string, productId: string) => {
    const product = await findStoreProduct(db, storeId, productId);

    if (!product) {
      return undefined;
    }

    const imageKeys = [product.image_key ?? null];

    await db.transaction(async (tx) => {
      const { records: links } = await tx.product_groups.findMany({
        select: { group_id: true },
        where: { product_id: productId }
      });

      await tx.product_groups.deleteMany({ where: { product_id: productId } });

      imageKeys.push(
        ...(await deleteOrphanGroups(
          tx,
          links.map(({ group_id }) => group_id)
        ))
      );

      await tx.stock_links.deleteMany({ where: { product_id: productId } });
      await tx.products.deleteOne({ where: { id: productId } });
    });

    return imageKeys.filter(isBucketImage);
  };

  export const setProductActive = async (db: DbClient, storeId: string, productId: string, active: boolean) => {
    const updated = await db.products.updateMany({
      select: { id: true },
      data: { active, updated_at: new Date().toISOString() },
      where: { id: productId, store_id: storeId }
    });

    return updated.length > 0;
  };

  export const setOptionActive = async (db: DbClient, storeId: string, optionId: string, active: boolean) => {
    const updated = await db.options.updateMany({
      select: { id: true },
      data: { active },
      where: { id: optionId, store_id: storeId }
    });

    return updated.length > 0;
  };

  /**
   * Replaces an option photo; returns the previous key (to delete its object), or undefined when the option is not
   * the store's.
   */
  export const setOptionImage = async (db: DbClient, storeId: string, optionId: string, imageKey: string | null) => {
    const option = await db.options.findOne({ select: { store_id: true, image_key: true }, where: { id: optionId } });

    if (option?.store_id !== storeId) {
      return undefined;
    }

    await db.options.updateOne({ data: { image_key: imageKey }, where: { id: optionId } });

    return { previousKey: option.image_key ?? null };
  };
}
