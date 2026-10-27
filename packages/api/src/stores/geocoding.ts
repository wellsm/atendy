import type { Coordinates } from './geo';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Half-size in degrees of the box the search prefers around the store (about 30 km).
 */
const BIAS_DEGREES = 0.3;

/**
 * Results precise enough to price a delivery. `APPROXIMATE` usually means only the city or neighborhood was found.
 */
const PRECISE_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER']);

/**
 * Google could not answer (no key, quota, denied key, HTTP or network failure). Never carries the key or the address.
 */
export class GeocodingError extends Error {}

export type GeocodedAddress = Coordinates & {
  formattedAddress: string;
};

type GeocodeResponse = {
  status?: string;
  results?: {
    formatted_address?: string;
    partial_match?: boolean;
    geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
  }[];
};

export namespace GoogleGeocodingClient {
  /**
   * First precise result for the address in Brazil, preferring the area around `near`; undefined when Google finds
   * nothing precise.
   */
  export const geocode = async (input: {
    apiKey: string | undefined;
    query: string;
    near?: Coordinates;
  }): Promise<GeocodedAddress | undefined> => {
    if (!input.apiKey) {
      throw new GeocodingError('GOOGLE_MAPS_API_KEY is not set');
    }

    const url = new URL(GEOCODE_URL);

    url.searchParams.set('address', input.query);
    url.searchParams.set('key', input.apiKey);
    url.searchParams.set('region', 'br');
    url.searchParams.set('language', 'pt-BR');
    url.searchParams.set('components', 'country:BR');

    if (input.near) {
      const { latitude, longitude } = input.near;

      url.searchParams.set(
        'bounds',
        `${latitude - BIAS_DEGREES},${longitude - BIAS_DEGREES}|${latitude + BIAS_DEGREES},${longitude + BIAS_DEGREES}`
      );
    }

    let body: GeocodeResponse;

    console.log(url);

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

      if (!response.ok) {
        throw new GeocodingError(`Geocoding request failed (${response.status})`);
      }

      body = (await response.json()) as GeocodeResponse;
    } catch (error) {
      if (error instanceof GeocodingError) {
        throw error;
      }

      throw new GeocodingError('Geocoding unreachable');
    }

    if (body.status === 'ZERO_RESULTS') {
      return undefined;
    }

    if (body.status !== 'OK') {
      throw new GeocodingError(`Geocoding failed (${body.status ?? 'unknown'})`);
    }

    // `bounds` only biases Google: a same-named street in another state still comes back, so it is dropped here.
    const inBox = (lat: number, lng: number) =>
      !input.near ||
      (Math.abs(lat - input.near.latitude) <= BIAS_DEGREES && Math.abs(lng - input.near.longitude) <= BIAS_DEGREES);

    const result = body.results?.find(
      ({ geometry, partial_match }) =>
        !partial_match &&
        PRECISE_TYPES.has(geometry?.location_type ?? '') &&
        typeof geometry?.location?.lat === 'number' &&
        typeof geometry.location.lng === 'number' &&
        inBox(geometry.location.lat, geometry.location.lng)
    );
    const location = result?.geometry?.location;

    if (!result?.formatted_address || typeof location?.lat !== 'number' || typeof location.lng !== 'number') {
      return undefined;
    }

    return { formattedAddress: result.formatted_address, latitude: location.lat, longitude: location.lng };
  };
}

/**
 * Geocoder for typed customer addresses: coordinates, or undefined when the address cannot be placed or Google is
 * unavailable (the model then asks for the WhatsApp location instead of guessing a fee).
 */
export const locateWithGoogle =
  (apiKey: string | undefined) =>
  async (query: string, near: Coordinates): Promise<Coordinates | undefined> => {
    try {
      const found = await GoogleGeocodingClient.geocode({ apiKey, query, near });

      return found && { latitude: found.latitude, longitude: found.longitude };
    } catch (error) {
      if (error instanceof GeocodingError) {
        return undefined;
      }

      throw error;
    }
  };
