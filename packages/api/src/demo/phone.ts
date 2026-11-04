import { SIMULATED_JID_SUFFIX } from '../simulations/repository';

/**
 * Fake customer phones of the demo: DDD `00` does not exist, so the number can never be dialed.
 */
export const DEMO_PHONE_PATTERN = /^5500\d{9}$/;

export const isDemoPhone = (phone: string) => DEMO_PHONE_PATTERN.test(phone);

export const demoJid = (phone: string) => `${phone}${SIMULATED_JID_SUFFIX}`;
