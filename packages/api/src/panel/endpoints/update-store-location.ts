import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelGeocodingProvider } from '../provider';
import type { PanelIdentity, PanelStoreLocation } from '../types';

import { HttpBadRequestError, HttpError } from '@ez4/gateway';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { GeocodingError, GoogleGeocodingClient } from '../../stores/geocoding';
import { StoreRepository } from '../../stores/repository';
import { requireStore } from '../store';

const MAX_ADDRESS_LENGTH = 200;

export declare class UpdateStoreLocationRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    address: string;
  };
}

export declare class UpdateStoreLocationResponse implements Http.Response {
  status: 200;
  body: {
    storeLocation: PanelStoreLocation;
  };
}

/**
 * Finds the store address with Google and saves its formatted address and coordinates (origin of distance delivery).
 */
export async function updateStoreLocationHandler(
  request: Http.Incoming<UpdateStoreLocationRequest>,
  { db }: Service.Context<PanelGeocodingProvider>
): Promise<UpdateStoreLocationResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const query = request.body.address.trim();

  if (!query || query.length > MAX_ADDRESS_LENGTH) {
    throw new HttpBadRequestError(`The address needs 1 to ${MAX_ADDRESS_LENGTH} characters.`, {
      field: 'store_location'
    });
  }

  const found = await (async () => {
    try {
      return await GoogleGeocodingClient.geocode({ apiKey: process.env.GOOGLE_MAPS_API_KEY, query });
    } catch (error) {
      if (error instanceof GeocodingError) {
        throw new HttpError(502, 'Maps service is unavailable');
      }

      console.error('Error while geocoding address', error);

      throw error;
    }
  })();

  if (!found) {
    throw new HttpBadRequestError('Address not found. Add street, number and city.', { field: 'store_location' });
  }

  const storeLocation = { address: found.formattedAddress, latitude: found.latitude, longitude: found.longitude };

  await StoreRepository.setStoreLocation(db, store.id, storeLocation);

  return { status: 200, body: { storeLocation } };
}
