import type { Coordinates } from '../stores/geo';

import { mediaBodyForModel } from './media';
import { reactionBodyForModel } from './reaction';

const PREFIX = '📍 Localização: ';

const LOCATION_PATTERN = /^📍 Localização: (-?\d{1,2}\.\d{6}),(-?\d{1,3}\.\d{6})$/u;

/**
 * Stored body of a WhatsApp location message. Readable in the panel and parsed back by code (`parseLocationBody`), so
 * coordinates never depend on the model.
 */
export const formatLocationBody = ({ latitude, longitude }: Coordinates) =>
  `${PREFIX}${latitude.toFixed(6)},${longitude.toFixed(6)}`;

export const parseLocationBody = (body: string): Coordinates | undefined => {
  const match = LOCATION_PATTERN.exec(body);

  if (!match) {
    return undefined;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }

  return { latitude, longitude };
};

/**
 * What the model reads for a message: a location body without its coordinates (the order already has them).
 */
export const bodyForModel = (body: string) =>
  parseLocationBody(body) ? '📍 Localização enviada' : (reactionBodyForModel(body) ?? mediaBodyForModel(body));
