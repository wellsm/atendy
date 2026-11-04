import { HttpNotFoundError } from '@ez4/gateway';

/**
 * `DEMO_ENABLED=true` turns on the demo phones (fake WhatsApp customers in the panel). Any other value keeps them off:
 * their routes answer 404 and the panel hides the button.
 */
export const isDemoEnabled = () => process.env.DEMO_ENABLED === 'true';

export const assertDemoEnabled = () => {
  if (!isDemoEnabled()) {
    throw new HttpNotFoundError('Demo is turned off (DEMO_ENABLED is not true).');
  }
};
