import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { getSettingsHandler } from '../../src/panel/endpoints/get-settings';
import { updateDeliveryHandler } from '../../src/panel/endpoints/update-delivery';
import { updateStoreLocationHandler } from '../../src/panel/endpoints/update-store-location';
import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode } from '../../src/stores/types';
import { seedStore } from '../support/fixtures';

describe('panel distance settings', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
  });

  afterEach(() => mock.restoreAll());

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, identity: { userId: 'user_1', orgId } };
  };

  const google = (body: unknown, status = 200) =>
    mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status })));

  const found = {
    status: 'OK',
    results: [
      {
        formatted_address: 'Rua Augusta, 100 - Consolação, São Paulo - SP, Brasil',
        geometry: { location: { lat: -23.553, lng: -46.651 }, location_type: 'ROOFTOP' }
      }
    ]
  };

  const bands = [
    { maxMeters: 2000, feeCents: 500 },
    { maxMeters: 5000, feeCents: 900 }
  ];

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  const locate = (identity: object, address: string) =>
    updateStoreLocationHandler({ identity, body: { address } } as never, { db });

  const saveDelivery = (identity: object, body: object) => updateDeliveryHandler({ identity, body } as never, { db });

  it('locates the store with Google and shows it in the settings', async () => {
    const { identity, storeId } = await setup();

    google(found);

    const { body } = await locate(identity, 'Rua Augusta 100');

    deepEqual(body.storeLocation, {
      address: 'Rua Augusta, 100 - Consolação, São Paulo - SP, Brasil',
      latitude: -23.553,
      longitude: -46.651
    });
    deepEqual(await StoreRepository.getStoreLocation(db, storeId), { latitude: -23.553, longitude: -46.651 });
    deepEqual((await getSettingsHandler({ identity } as never, { db })).body.storeLocation, body.storeLocation);
  });

  it('refuses an address Google cannot place and reports Google failures as 502', async () => {
    const { identity } = await setup();

    google({ status: 'ZERO_RESULTS', results: [] });
    await rejects(locate(identity, 'Rua Inexistente 0'), badField('store_location'));

    mock.restoreAll();
    google({ status: 'OVER_QUERY_LIMIT', results: [] });
    await rejects(
      locate(identity, 'Rua Augusta 100'),
      (error: unknown) => error instanceof HttpError && error.status === 502
    );

    await rejects(locate(identity, '  '), badField('store_location'));
  });

  it('needs the store location before delivering by distance', async () => {
    const { identity } = await setup();

    await rejects(
      saveDelivery(identity, { mode: DeliveryMode.ByDistance, flatFeeCents: 0, zones: [], bands }),
      badField('store_location')
    );
  });

  it('saves bands, and drops them when switching mode', async () => {
    const { identity, storeId } = await setup();

    google(found);
    await locate(identity, 'Rua Augusta 100');

    const { body } = await saveDelivery(identity, { mode: DeliveryMode.ByDistance, flatFeeCents: 0, zones: [], bands });

    deepEqual(body.delivery.bands, bands);
    deepEqual(await StoreRepository.getBands(db, storeId), bands);
    equal((await getSettingsHandler({ identity } as never, { db })).body.delivery.mode, DeliveryMode.ByDistance);

    await rejects(
      saveDelivery(identity, {
        mode: DeliveryMode.ByDistance,
        flatFeeCents: 0,
        zones: [],
        bands: [bands[1], bands[0]]
      }),
      badField('bands')
    );
    deepEqual(await StoreRepository.getBands(db, storeId), bands);

    await saveDelivery(identity, { mode: DeliveryMode.Flat, flatFeeCents: 700, zones: [] });
    deepEqual(await StoreRepository.getBands(db, storeId), []);
  });
});
