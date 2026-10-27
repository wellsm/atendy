import type { Client } from '@ez4/storage';
import type { PanelMenuGroup } from './repository';

import { randomUUID } from 'node:crypto';

const READ_SECONDS = 3600;

export const UPLOAD_SECONDS = 300;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * What a photo belongs to; also the first segment of its object key.
 */
export type ImageTarget = 'products' | 'options';

/**
 * Where the browser PUTs before `complete` checks and promotes it: a bad upload never replaces the published photo.
 */
export const stagingKey = (storeId: string, target: ImageTarget, id: string) => `uploads/${storeId}/${target}/${id}`;

/**
 * A new key per upload, so a cached signed URL of the old photo never shows the new one.
 */
export const imageKey = (storeId: string, target: ImageTarget, id: string) =>
  `${target}/${storeId}/${id}/${randomUUID()}`;

export const isImageUpload = (type: string, size: number) =>
  (IMAGE_TYPES as readonly string[]).includes(type) && size > 0 && size <= MAX_IMAGE_BYTES;

/**
 * Key prefix of demo menu photos. They live with the web app (`packages/web/demo-menu/`, its `DemoMenuFiles` bucket on
 * deployed stages), never in this bucket.
 */
export const DEMO_IMAGE_PREFIX = 'demo-menu/';

/**
 * Whether the key is an object in the bucket (not a demo photo), so it can be signed or deleted.
 */
export const isBucketImage = (key: string | null): key is string => !!key && !key.startsWith(DEMO_IMAGE_PREFIX);

/**
 * Signed read URL of a key (null without a photo); demo photos get their web-relative path.
 */
export const signImage = async (bucket: Client, key: string | null) => {
  if (!key) {
    return null;
  }

  if (!isBucketImage(key)) {
    return `/${key}`;
  }

  return bucket.getReadUrl(key, { expiresIn: READ_SECONDS });
};

/**
 * Swaps the product's and its options' bucket keys for signed read URLs.
 */
export const withImageUrl = async <P extends { imageKey: string | null; groups: PanelMenuGroup[] }>(
  bucket: Client,
  product: P
) => {
  const { imageKey: key, groups, ...rest } = product;

  return {
    ...rest,
    imageUrl: await signImage(bucket, key),
    groups: await Promise.all(
      groups.map(async ({ options, ...group }) => ({
        ...group,
        options: await Promise.all(
          options.map(async ({ imageKey: optionKey, ...option }) => ({
            ...option,
            imageUrl: await signImage(bucket, optionKey)
          }))
        )
      }))
    )
  };
};

export const withImageUrls = <P extends { imageKey: string | null; groups: PanelMenuGroup[] }>(
  bucket: Client,
  categories: { id: string; name: string; products: P[] }[]
) =>
  Promise.all(
    categories.map(async ({ id, name, products }) => ({
      id,
      name,
      products: await Promise.all(products.map((product) => withImageUrl(bucket, product)))
    }))
  );
