import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { GeocodingError, GoogleGeocodingClient } from '../../src/stores/geocoding';

const respond = (body: unknown, status = 200) => {
  const urls: string[] = [];

  mock.method(globalThis, 'fetch', (url: string) => {
    urls.push(url);

    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });

  return urls;
};

const result = (locationType: string) => ({
  formatted_address: 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP, Brasil',
  geometry: { location: { lat: -23.561414, lng: -46.655881 }, location_type: locationType }
});

describe('GoogleGeocodingClient', () => {
  afterEach(() => mock.restoreAll());

  it('geocodes in Brazil, biased around the store', async () => {
    const urls = respond({ status: 'OK', results: [result('ROOFTOP')] });

    const found = await GoogleGeocodingClient.geocode({
      apiKey: 'key-1',
      query: 'Av Paulista 1578',
      near: { latitude: -23.55, longitude: -46.63 }
    });

    deepEqual(found, {
      formattedAddress: 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP, Brasil',
      latitude: -23.561414,
      longitude: -46.655881
    });

    const url = new URL(urls[0]!);

    equal(url.origin + url.pathname, 'https://maps.googleapis.com/maps/api/geocode/json');
    equal(url.searchParams.get('address'), 'Av Paulista 1578');
    equal(url.searchParams.get('key'), 'key-1');
    equal(url.searchParams.get('region'), 'br');
    equal(url.searchParams.get('components'), 'country:BR');
    ok(url.searchParams.get('bounds'));
  });

  it('returns nothing for no result or an imprecise one', async () => {
    respond({ status: 'ZERO_RESULTS', results: [] });
    equal(await GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'nowhere' }), undefined);

    mock.restoreAll();
    respond({ status: 'OK', results: [result('APPROXIMATE')] });
    equal(await GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'São Paulo' }), undefined);
  });

  it('fails on quota, denied key, HTTP errors and network errors', async () => {
    respond({ status: 'OVER_QUERY_LIMIT', results: [] });
    await rejects(GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'x' }), GeocodingError);

    mock.restoreAll();
    respond({ status: 'REQUEST_DENIED', results: [] });
    await rejects(GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'x' }), GeocodingError);

    mock.restoreAll();
    respond({}, 500);
    await rejects(GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'x' }), GeocodingError);

    mock.restoreAll();
    mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError('fetch failed')));
    await rejects(GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'x' }), GeocodingError);
  });

  it('fails without a key, never calling Google', async () => {
    const urls = respond({ status: 'OK', results: [result('ROOFTOP')] });

    await rejects(GoogleGeocodingClient.geocode({ apiKey: undefined, query: 'x' }), GeocodingError);
    equal(urls.length, 0);
  });

  it('drops results far from the store or only partly matching', async () => {
    const near = { latitude: -23.55, longitude: -46.63 };

    // Same street name in another state.
    respond({
      status: 'OK',
      results: [
        {
          formatted_address: 'Rua das Flores, 10 - Curitiba - PR',
          geometry: { location: { lat: -25.43, lng: -49.27 }, location_type: 'ROOFTOP' }
        }
      ]
    });
    equal(await GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'Rua das Flores 10', near }), undefined);

    mock.restoreAll();
    respond({ status: 'OK', results: [{ ...result('ROOFTOP'), partial_match: true }] });
    equal(await GoogleGeocodingClient.geocode({ apiKey: 'k', query: 'Av Paulista 9999', near }), undefined);
  });
});
