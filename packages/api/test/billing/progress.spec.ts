import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { billingAmountCents, billingPercent, BillingStep, stepsFromCart } from '../../src/billing/progress';
import { CartMissing } from '../../src/orders/repository';

const cart = (items: number, missing: CartMissing[]) => ({ items: Array.from<never>({ length: items }), missing });

describe('billing progress', () => {
  it('reads the steps a draft satisfies', () => {
    deepEqual(stepsFromCart(cart(0, [CartMissing.Items, CartMissing.Fulfillment, CartMissing.Payment])), []);
    deepEqual(stepsFromCart(cart(2, [CartMissing.Fulfillment, CartMissing.Payment])), [BillingStep.Items]);
    deepEqual(stepsFromCart(cart(2, [CartMissing.Address, CartMissing.Payment])), [
      BillingStep.Items,
      BillingStep.Fulfillment
    ]);
    deepEqual(stepsFromCart(cart(2, [CartMissing.Payment])), [
      BillingStep.Items,
      BillingStep.Fulfillment,
      BillingStep.Address
    ]);
    // Payment without delivery/pickup: the address is not counted yet.
    deepEqual(stepsFromCart(cart(1, [CartMissing.Fulfillment])), [BillingStep.Items, BillingStep.Payment]);
  });

  it('prices the progress: 10 % nothing, 40 % items, +15 % per step, 100 % placed, 0 % on our failures', () => {
    equal(billingPercent([]), 10);
    equal(billingPercent([BillingStep.Items]), 40);
    equal(billingPercent([BillingStep.Items, BillingStep.Fulfillment, BillingStep.Address]), 70);
    equal(billingPercent([BillingStep.Items, BillingStep.Fulfillment, BillingStep.Address, BillingStep.Payment]), 85);
    equal(billingPercent([BillingStep.Placed]), 100);
    equal(billingPercent([BillingStep.Items], 'technical_error'), 0);
    equal(billingPercent([], 'send_failed'), 0);
    equal(billingPercent([BillingStep.Items], 'agent_requested'), 40);
  });

  it('rounds the amount up to the cent', () => {
    equal(billingAmountCents(50, 55), 28);
    equal(billingAmountCents(50, 85), 43);
    equal(billingAmountCents(50, 10), 5);
    equal(billingAmountCents(99, 15), 15);
    equal(billingAmountCents(50, 0), 0);
  });
});
