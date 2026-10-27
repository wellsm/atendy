const EARTH_RADIUS_METERS = 6_371_000;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type DeliveryBand = {
  maxMeters: number;
  feeCents: number;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Straight-line (Haversine) distance in whole meters. Roads are usually 20–40 % longer.
 */
export const distanceMeters = (from: Coordinates, to: Coordinates) => {
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h))));
};

/**
 * Fee of the first band covering the distance (bands sorted by `maxMeters`); undefined = not served.
 */
export const pickBandFee = (bands: DeliveryBand[], meters: number) => {
  return bands.find(({ maxMeters }) => meters <= maxMeters)?.feeCents;
};
