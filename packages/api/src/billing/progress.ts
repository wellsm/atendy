import type { Cart } from '../orders/repository';

import { CartMissing } from '../orders/repository';

/**
 * What the AI finished in an order, in the order the bot usually collects it.
 */
export const enum BillingStep {
  Items = 'items',
  Fulfillment = 'fulfillment',
  Address = 'address',
  Payment = 'payment',
  Placed = 'placed'
}

export const DEFAULT_ORDER_PRICE_CENTS = 50;

/**
 * Share of the store price billed for an order the customer placed on the public menu (no AI work), when the store
 * has no `web_order_percent`.
 */
export const DEFAULT_WEB_ORDER_PERCENT = 30;

/**
 * Handoffs caused by us (AI or WhatsApp failure): the store pays nothing for that order.
 */
const FAILURE_REASONS = new Set(['technical_error', 'send_failed']);

const NOTHING_PERCENT = 10;

const ITEMS_PERCENT = 40;

const STEP_PERCENT = 15;

const ADDRESS_MISSING = [CartMissing.Address, CartMissing.Location, CartMissing.DeliveryArea];

/**
 * Steps a draft already satisfies. Address counts only once delivery or pickup is chosen (pickup needs none).
 */
export const stepsFromCart = (cart: Pick<Cart, 'items' | 'missing'>) => {
  const missing = new Set(cart.missing);
  const steps: BillingStep[] = [];

  if (cart.items.length) {
    steps.push(BillingStep.Items);
  }

  if (!missing.has(CartMissing.Fulfillment)) {
    steps.push(BillingStep.Fulfillment);

    if (!ADDRESS_MISSING.some((step) => missing.has(step))) {
      steps.push(BillingStep.Address);
    }
  }

  if (!missing.has(CartMissing.Payment)) {
    steps.push(BillingStep.Payment);
  }

  return steps;
};

/**
 * Steps an order row reached, from its stored fields (no cart recompute): items, delivery or pickup, address (pickup
 * needs none), payment, placed. For abandoned drafts and the conversation's progress.
 */
export const stepsFromOrder = (order: {
  subtotal_cents: number;
  fulfillment?: string | null;
  address?: string | null;
  payment_method?: string | null;
  placed_at?: string | null;
}) => {
  const steps: BillingStep[] = [];

  if (order.subtotal_cents > 0) {
    steps.push(BillingStep.Items);
  }

  if (order.fulfillment) {
    steps.push(BillingStep.Fulfillment);

    if (order.fulfillment === 'pickup' || order.address) {
      steps.push(BillingStep.Address);
    }
  }

  if (order.payment_method) {
    steps.push(BillingStep.Payment);
  }

  if (order.placed_at) {
    steps.push(BillingStep.Placed);
  }

  return steps;
};

/**
 * 10 % for a conversation that never got an item; 40 % for items plus 15 % per further step (85 % at most); 100 %
 * placed. Failures caused by us are 0 %.
 */
export const billingPercent = (steps: BillingStep[], handoffReason?: string | null) => {
  if (handoffReason && FAILURE_REASONS.has(handoffReason)) {
    return 0;
  }

  if (steps.includes(BillingStep.Placed)) {
    return 100;
  }

  if (!steps.includes(BillingStep.Items)) {
    return NOTHING_PERCENT;
  }

  return ITEMS_PERCENT + STEP_PERCENT * steps.filter((step) => step !== BillingStep.Items).length;
};

/**
 * Rounded up to the cent.
 */
export const billingAmountCents = (priceCents: number, percent: number) => Math.ceil((priceCents * percent) / 100);
