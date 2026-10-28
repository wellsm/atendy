import type { Discount, OrderStatus } from '../orders/types';
import type { PanelCartItem } from '../panel/types';
import type { StorefrontProduct } from '../storefront/types';
import type { PaymentMethod } from '../stores/types';

/**
 * One payment of a sale (`order_payments`).
 */
export type PosPayment = {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  /**
   * Cash only: what the customer handed over and the change given.
   */
  receivedCents: number | null;
  changeCents: number | null;
};

/**
 * A payment the operator typed: `receivedCents` only for cash (what the customer handed over).
 */
export type PosPaymentInput = {
  method: PaymentMethod;
  amountCents: number;
  receivedCents?: number | null;
};

export type PosSaleItem = PanelCartItem & {
  discount: Discount | null;
};

/**
 * A counter sale: held while `draft`. `customer` is null without a name or phone; `id` is null for a name only.
 */
export type PosSale = {
  id: string;
  status: OrderStatus;
  code: string | null;
  label: string | null;
  notes: string | null;
  customer: { id: string | null; name: string | null; phone: string | null } | null;
  items: PosSaleItem[];
  discount: Discount | null;
  subtotalCents: number;
  discountCents: number;
  surchargeCents: number;
  totalCents: number;
  payments: PosPayment[];
  /**
   * Some line needs the kitchen (product flag, else its category's).
   */
  needsPreparation: boolean;
  createdAt: string;
  placedAt: string | null;
};

/**
 * A sale in the list (held, or finalized with its code and times); `itemsCount` sums the line quantities.
 */
export type PosHeldSale = {
  id: string;
  label: string | null;
  code: string | null;
  status: OrderStatus;
  totalCents: number;
  itemsCount: number;
  createdAt: string;
  placedAt: string | null;
  canceledAt: string | null;
};

export const enum PosSaleList {
  Held = 'held',
  /**
   * POS sales paid in the open cash session or, without cash control, placed today (store time); canceled included.
   */
  Finalized = 'finalized'
}

/**
 * Sale fields the operator edits: absent keeps the value, null clears it. `customer` replaces name and phone.
 */
export type PosSalePatch = {
  label?: string | null;
  notes?: string | null;
  discount?: Discount | null;
  surchargeCents?: number | null;
  customer?: { name?: string | null; phone?: string | null } | null;
};

export type PosLinePatch = {
  qty?: number;
  notes?: string | null;
  discount?: Discount | null;
};

export type PosMenuProduct = StorefrontProduct & {
  needsPreparation: boolean | null;
};

export type PosMenuCategory = {
  id: string;
  name: string;
  needsPreparation: boolean;
  products: PosMenuProduct[];
};
