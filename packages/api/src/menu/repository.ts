import type { DbClient } from '../db';
import type { PriceMode } from './types';
import type { GroupDraft, OptionDraft, ProductDraft } from './validation';
import type { PricingProduct } from '../orders/pricing';

import { randomUUID } from 'node:crypto';

import { MAX_CATEGORIES, MenuError } from './validation';

export type PanelMenuOption = Required<Omit<OptionDraft, 'id'>> & {
  id: string;
};

export type PanelMenuGroup = Omit<GroupDraft, 'id' | 'options'> & {
  id: string;
  options: PanelMenuOption[];
};

export type PanelMenuProduct = Omit<ProductDraft, 'active' | 'groups'> & {
  id: string;
  active: boolean;
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
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/**
 * Panel shape of the given products, with every group and option (active or not) in position order.
 */
const mapProducts = async (db: DbClient, products: ProductRow[]): Promise<PanelMenuProduct[]> => {
  if (!products.length) {
    return [];
  }

  const { records: groups } = await db.option_groups.findMany({
    select: { id: true, product_id: true, name: true, min: true, max: true, price_mode: true, position: true },
    where: { product_id: { isIn: products.map(({ id }) => id) } }
  });

  const { records: options } = groups.length
    ? await db.options.findMany({
        select: { id: true, group_id: true, name: true, price_delta_cents: true, active: true, position: true },
        where: { group_id: { isIn: groups.map(({ id }) => id) } }
      })
    : { records: [] };

  return [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      description: product.description ?? null,
      priceCents: product.price_cents,
      active: product.active,
      groups: groups
        .filter(({ product_id }) => product_id === product.id)
        .sort(byPosition)
        .map((group) => ({
          id: group.id,
          name: group.name,
          min: group.min,
          max: group.max,
          priceMode: group.price_mode,
          options: options
            .filter(({ group_id }) => group_id === group.id)
            .sort(byPosition)
            .map(({ id, name, price_delta_cents, active }) => ({
              id,
              name,
              priceDeltaCents: price_delta_cents,
              active
            }))
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
  active: true
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

/**
 * Writes the groups and options of a product: sent ids are updated in place, the rest is created, and current rows
 * missing from the draft are deleted. Every sent id must already belong to this product (options: to the same
 * group); the check runs before any write.
 */
const writeGroups = async (db: DbClient, storeId: string, productId: string, groups: GroupDraft[]) => {
  const { records: currentGroups } = await db.option_groups.findMany({
    select: { id: true },
    where: { product_id: productId }
  });

  const groupIds = currentGroups.map(({ id }) => id);

  const { records: currentOptions } = groupIds.length
    ? await db.options.findMany({ select: { id: true, group_id: true }, where: { group_id: { isIn: groupIds } } })
    : { records: [] };

  for (const group of groups) {
    if (group.id !== undefined && !groupIds.includes(group.id)) {
      throw new MenuError('ids', 'Unknown group.');
    }

    for (const option of group.options) {
      const current = currentOptions.find(({ id }) => id === option.id);

      if (option.id !== undefined && (group.id === undefined || current?.group_id !== group.id)) {
        throw new MenuError('ids', 'Unknown option.');
      }
    }
  }

  const keptGroups = new Set(groups.map(({ id }) => id));
  const keptOptions = new Set(groups.flatMap(({ options }) => options.map(({ id }) => id)));

  const droppedGroups = groupIds.filter((id) => !keptGroups.has(id));
  const droppedOptions = currentOptions.filter(({ id }) => !keptOptions.has(id)).map(({ id }) => id);

  if (droppedOptions.length) {
    await db.options.deleteMany({ where: { id: { isIn: droppedOptions } } });
  }

  if (droppedGroups.length) {
    await db.option_groups.deleteMany({ where: { id: { isIn: droppedGroups } } });
  }

  for (const [groupPosition, group] of groups.entries()) {
    const groupData = {
      name: group.name,
      min: group.min,
      max: group.max,
      price_mode: group.priceMode,
      position: groupPosition
    };

    const groupId = group.id ?? randomUUID();

    if (group.id === undefined) {
      await db.option_groups.insertOne({
        data: { id: groupId, store_id: storeId, product_id: productId, ...groupData }
      });
    } else {
      await db.option_groups.updateOne({ data: groupData, where: { id: groupId } });
    }

    for (const [optionPosition, option] of group.options.entries()) {
      const optionData = {
        name: option.name,
        price_delta_cents: option.priceDeltaCents,
        position: optionPosition
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
  }
};

export type MenuProduct = PricingProduct & {
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

    const { records: groups } = await db.option_groups.findMany({
      select: { id: true, product_id: true, name: true, min: true, max: true, price_mode: true, position: true },
      where: { product_id: { isIn: products.map(({ id }) => id) } }
    });

    const { records: options } = groups.length
      ? await db.options.findMany({
          select: { id: true, group_id: true, name: true, price_delta_cents: true, active: true, position: true },
          where: { group_id: { isIn: groups.map(({ id }) => id) } }
        })
      : { records: [] };

    const categoryOf = new Map(categories.map((category) => [category.id, category]));

    const categoryPosition = (categoryId: string) => categoryOf.get(categoryId)?.position ?? Number.MAX_SAFE_INTEGER;

    return [...products]
      .sort((a, b) => categoryPosition(a.category_id) - categoryPosition(b.category_id) || a.name.localeCompare(b.name))
      .map((product) => ({
        id: product.id,
        name: product.name,
        category: categoryOf.get(product.category_id)?.name ?? '',
        description: product.description ?? null,
        price_cents: product.price_cents,
        active: product.active,
        groups: groups
          .filter(({ product_id }) => product_id === product.id)
          .sort(byPosition)
          .map((group) => ({
            id: group.id,
            name: group.name,
            min: group.min,
            max: group.max,
            price_mode: group.price_mode,
            options: options
              .filter(({ group_id }) => group_id === group.id)
              .sort(byPosition)
              .map(({ id, name, price_delta_cents, active }) => ({ id, name, price_delta_cents, active }))
          }))
      }));
  };

  /**
   * Inserts the whole menu as active items. Used by the demo seed and tests; the store panel saves product by product.
   */
  export const importMenu = async (db: DbClient, storeId: string, menu: MenuImport) => {
    const now = new Date().toISOString();

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
            active: true,
            created_at: now,
            updated_at: now
          }
        });

        for (const [groupPosition, group] of (product.groups ?? []).entries()) {
          const groupId = randomUUID();

          await db.option_groups.insertOne({
            data: {
              id: groupId,
              store_id: storeId,
              product_id: productId,
              name: group.name,
              min: group.min,
              max: group.max,
              price_mode: group.price_mode,
              position: groupPosition
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
      }
    }
  };

  /**
   * Whole menu for the panel: categories by position, products by name, inactive items included.
   */
  export const loadPanel = async (db: DbClient, storeId: string): Promise<PanelMenuCategory[]> => {
    const [{ records: categories }, { records: products }] = await Promise.all([
      db.categories.findMany({ select: { id: true, name: true, position: true }, where: { store_id: storeId } }),
      db.products.findMany({ select: PRODUCT_FIELDS, where: { store_id: storeId } })
    ]);

    const panelProducts = await mapProducts(db, products);

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

    const [panelProduct] = await mapProducts(db, [product]);

    return panelProduct;
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
   * Product with its groups and options, in one transaction.
   */
  export const createProduct = async (db: DbClient, storeId: string, draft: ProductDraft) => {
    await assertStoreCategory(db, storeId, draft.categoryId);

    const productId = randomUUID();
    const now = new Date().toISOString();

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

      await writeGroups(tx, storeId, productId, draft.groups);
    });

    return (await getProduct(db, storeId, productId))!;
  };

  /**
   * Replaces the product, its groups and options in one transaction, keeping the ids it was sent.
   * Returns undefined when the product is not this store's.
   */
  export const replaceProduct = async (db: DbClient, storeId: string, productId: string, draft: ProductDraft) => {
    if (!(await findStoreProduct(db, storeId, productId))) {
      return undefined;
    }

    await assertStoreCategory(db, storeId, draft.categoryId);

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

      await writeGroups(tx, storeId, productId, draft.groups);
    });

    return getProduct(db, storeId, productId);
  };

  export const deleteProduct = async (db: DbClient, storeId: string, productId: string) => {
    if (!(await findStoreProduct(db, storeId, productId))) {
      return false;
    }

    await db.transaction(async (tx) => {
      const { records: groups } = await tx.option_groups.findMany({
        select: { id: true },
        where: { product_id: productId }
      });

      if (groups.length) {
        await tx.options.deleteMany({ where: { group_id: { isIn: groups.map(({ id }) => id) } } });
        await tx.option_groups.deleteMany({ where: { product_id: productId } });
      }

      await tx.products.deleteOne({ where: { id: productId } });
    });

    return true;
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
}
