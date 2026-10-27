import type { Client } from '@ez4/storage';
import type { DbClient } from '../db';
import type { ImageTarget } from '../menu/images';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';

import { isImageUpload } from '../menu/images';
import { MenuRepository } from '../menu/repository';

/**
 * Whether the product or option belongs to the store.
 */
export const imageOwnerExists = async (db: DbClient, storeId: string, target: ImageTarget, id: string) => {
  if (target === 'products') {
    return !!(await MenuRepository.getProduct(db, storeId, id));
  }

  const option = await db.options.findOne({ select: { store_id: true }, where: { id } });

  return option?.store_id === storeId;
};

/**
 * Saves the photo key on the product or option; undefined when it is not the store's.
 */
export const setImageKey = (db: DbClient, storeId: string, target: ImageTarget, id: string, key: string | null) =>
  target === 'products'
    ? MenuRepository.setImage(db, storeId, id, key)
    : MenuRepository.setOptionImage(db, storeId, id, key);

/**
 * Checks the staged upload (type and size) and copies it to its published key; a bad file is dropped.
 */
export const publishUpload = async (bucket: Client, staged: string, key: string) => {
  const stats = await bucket.stat(staged);

  if (!stats) {
    throw new HttpNotFoundError('Upload not found');
  }

  if (!isImageUpload(stats.type, stats.size)) {
    await bucket.delete(staged);

    throw new HttpBadRequestError('Invalid image.', { field: 'image' });
  }

  await bucket.copy(staged, key);
  await bucket.delete(staged);
};
