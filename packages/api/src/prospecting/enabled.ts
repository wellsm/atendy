import { HttpNotFoundError } from '@ez4/gateway';

/**
 * `PROSPECTING_ENABLED=false` turns the whole module off: the cron and the webhook return before touching the database
 * (so Neon can scale to zero) and the admin routes answer 404. Any other value keeps it on.
 */
export const isProspectingEnabled = () => process.env.PROSPECTING_ENABLED !== 'false';

export const PROSPECTING_OFF_MESSAGE = 'Prospecting is turned off (PROSPECTING_ENABLED=false).';

export const assertProspectingEnabled = () => {
  if (!isProspectingEnabled()) {
    throw new HttpNotFoundError(PROSPECTING_OFF_MESSAGE);
  }
};
