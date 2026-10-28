import type { DbClient } from '../db';

import { StockRepository } from '../stock/repository';

export type PosBarcodeCandidate = {
  productId: string;
  productName: string;
  selection: { groupId: string; optionId: string; optionName: string } | null;
};

/**
 * What a scanned code stands for: an item code is one unit (links with qty 1), a package code is `factor` units.
 * An option link yields one candidate per active product that has the option's group; inactive ones are dropped.
 */
export const resolvePosBarcode = async (db: DbClient, storeId: string, code: string) => {
  const found = await StockRepository.findByBarcode(db, storeId, code);

  if (!found) {
    return [];
  }

  const qty = 'package' in found && found.package ? found.package.factor : 1;
  const links = await StockRepository.linksForQty(db, storeId, found.item.id, qty);
  const candidates: PosBarcodeCandidate[] = [];

  const addProduct = async (productId: string, option?: { id: string; name: string; groupId: string }) => {
    const product = await db.products.findOne({
      select: { name: true, active: true, store_id: true },
      where: { id: productId }
    });

    if (product?.store_id === storeId && product.active) {
      candidates.push({
        productId,
        productName: product.name,
        selection: option ? { groupId: option.groupId, optionId: option.id, optionName: option.name } : null
      });
    }
  };

  for (const link of links) {
    if (link.productId) {
      await addProduct(link.productId);
    }

    if (link.optionId) {
      const option = await db.options.findOne({
        select: { name: true, active: true, group_id: true, store_id: true },
        where: { id: link.optionId }
      });

      if (option?.store_id !== storeId || !option.active) {
        continue;
      }

      const { records: linked } = await db.product_groups.findMany({
        select: { product_id: true },
        where: { store_id: storeId, group_id: option.group_id }
      });

      for (const { product_id } of linked) {
        await addProduct(product_id, { id: link.optionId, name: option.name, groupId: option.group_id });
      }
    }
  }

  return candidates;
};
