import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { StorefrontProvider } from '../provider';
import type { StorefrontCategory, StorefrontStore } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { withImageUrls } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { closesAt, isStoreOpen } from '../../stores/hours';
import { StoreRepository } from '../../stores/repository';
import { deliveryFromCents } from '../delivery';

export declare class GetStorefrontRequest implements Http.Request {
  parameters: {
    slug: string;
  };
}

export declare class GetStorefrontResponse implements Http.Response {
  status: 200;
  body: {
    store: StorefrontStore;
    categories: StorefrontCategory[];
  };
}

/**
 * Public menu of an active store (no auth): active products only, sold-out options included.
 */
export async function getStorefrontHandler(
  request: Http.Incoming<GetStorefrontRequest>,
  { db, productImages }: Service.Context<StorefrontProvider>
): Promise<GetStorefrontResponse> {
  const store = await StoreRepository.findBySlug(db, request.parameters.slug);

  if (!store?.active) {
    throw new HttpNotFoundError('Store not found');
  }

  const [settings, menu] = await Promise.all([
    StoreRepository.getSettings(db, store.id),
    MenuRepository.loadPanel(db, store.id)
  ]);

  if (!settings) {
    throw new HttpNotFoundError('Store not found');
  }

  const now = new Date();

  const categories = menu
    .map(({ id, name, products }) => ({
      id,
      name,
      products: products
        .filter(({ active }) => active)
        .map(({ id, name, description, priceCents, soldOut, imageKey, groups }) => ({
          id,
          name,
          description,
          priceCents,
          soldOut,
          imageKey,
          groups
        }))
    }))
    .filter(({ products }) => products.length);

  return {
    status: 200,
    body: {
      store: {
        name: store.name,
        slug: store.slug,
        open: store.accepting_orders && isStoreOpen(settings.hours, store.timezone, now),
        closesAt: closesAt(settings.hours, store.timezone, now),
        deliveryFromCents: deliveryFromCents(settings.delivery),
        minOrderCents: settings.policy.min_order_cents ?? null,
        paymentMethods: settings.paymentMethods,
        deliveryMode: settings.delivery.mode
      },
      categories: await withImageUrls(productImages, categories)
    }
  };
}
