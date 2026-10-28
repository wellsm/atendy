import type { JevAnswer } from '../../src/agent/jev-client';
import type { LastOrder } from '../../src/agent/prompt';
import type { MenuProduct } from '../../src/menu/repository';
import type { Cart } from '../../src/orders/repository';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildJevPlan,
  decideJevAction,
  groupQuestionId,
  Intent,
  NONE_OF_THESE,
  NOT_MENTIONED,
  Q_FULFILLMENT,
  Q_HUMAN,
  Q_INTENT,
  Q_NOTES,
  Q_PAYMENT,
  Q_PRANK,
  Q_PRODUCT,
  Q_QTY,
  Q_REMOVE
} from '../../src/agent/jev-router';
import { ToolName } from '../../src/agent/tools';
import { PriceMode } from '../../src/menu/types';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { PaymentMethod } from '../../src/stores/types';

const option = (id: string, name: string) => ({ id, name, price_delta_cents: 1000, active: true });

const grande: MenuProduct = {
  id: 'p-grande',
  name: 'Pizza Grande',
  category_id: 'c-pizzas',
  category: 'Pizzas',
  description: null,
  price_cents: 0,
  active: true,
  groups: [
    {
      id: 'g-sabores',
      name: 'Sabores',
      min: 1,
      max: 2,
      price_mode: PriceMode.Max,
      options: [option('o-cal', 'Calabresa')]
    },
    {
      id: 'g-borda-grande',
      name: 'Borda',
      min: 0,
      max: 1,
      price_mode: PriceMode.Sum,
      options: [option('o-cat', 'Catupiry')]
    }
  ]
};

const broto: MenuProduct = {
  id: 'p-broto',
  name: 'Pizza Broto',
  category_id: 'c-pizzas',
  category: 'Pizzas',
  description: null,
  price_cents: 0,
  active: true,
  groups: [
    {
      id: 'g-sabor',
      name: 'Sabor',
      min: 1,
      max: 1,
      price_mode: PriceMode.Sum,
      options: [option('o-bcal', 'Calabresa'), option('o-bmus', 'Mussarela')]
    },
    {
      id: 'g-borda-broto',
      name: 'Borda',
      min: 0,
      max: 1,
      price_mode: PriceMode.Sum,
      options: [option('o-bcat', 'Catupiry')]
    }
  ]
};

const coca: MenuProduct = {
  id: 'p-coca',
  name: 'Coca-Cola 2L',
  category_id: 'c-bebidas',
  category: 'Bebidas',
  description: null,
  price_cents: 1400,
  active: true,
  groups: []
};

const menu = [broto, grande, coca];

const cart: Cart = {
  order_id: 'o1',
  status: OrderStatus.Draft,
  items: [
    {
      item_id: 'i-1',
      name: 'Coca-Cola 2L',
      qty: 1,
      options: '',
      unit_price_cents: 1400,
      line_total_cents: 1400,
      notes: null
    }
  ],
  fulfillment: null,
  address: null,
  neighborhood: null,
  payment_method: null,
  change_for_cents: null,
  subtotal_cents: 1400,
  discount_cents: 0,
  fee_cents: 0,
  surcharge_cents: 0,
  total_cents: 1400,
  missing: []
};

const plan = (withCart = false) =>
  buildJevPlan({
    messages: ['quero uma broto de calabresa'],
    history: [],
    cart: withCart ? cart : undefined,
    candidates: menu,
    paymentMethods: [PaymentMethod.Pix, PaymentMethod.Cash]
  });

/**
 * Every choice not given defaults to "not mentioned" / "none of these" / first key with high confidence.
 */
const answers = (
  current: ReturnType<typeof plan>,
  picks: Record<string, [string, number]>,
  human = 0.02
): Record<string, JevAnswer> => {
  return Object.fromEntries(
    Object.entries(current.questions).map(([id, question]): [string, JevAnswer] => {
      if (question.type === 'noul') {
        return [id, { type: 'noul', noul: id === Q_HUMAN ? human : 0 }];
      }

      const keys = Object.keys(question.criteria);
      const fallback = keys.includes(NOT_MENTIONED)
        ? NOT_MENTIONED
        : keys.includes(NONE_OF_THESE)
          ? NONE_OF_THESE
          : keys[0]!;
      const [choice, confidence] = picks[id] ?? [fallback, 0.9];

      return [id, { type: 'choice', choice, probabilities: {}, confidence }];
    })
  );
};

const decide = (current: ReturnType<typeof plan>, picks: Record<string, [string, number]>, human?: number) =>
  decideJevAction(current, answers(current, picks, human), { menu, text: 'quero uma broto de calabresa' });

describe('buildJevPlan', () => {
  it('asks group questions only for single-choice groups of the top candidates', () => {
    const { questions } = plan();

    equal(groupQuestionId('g-sabor') in questions, true);
    equal(groupQuestionId('g-borda-grande') in questions, true);
    equal(groupQuestionId('g-sabores') in questions, false);
  });

  it('offers products by name and category, the store payment methods and no remove question without a cart', () => {
    const { questions } = plan();
    const product = questions[Q_PRODUCT];
    const payment = questions[Q_PAYMENT];

    deepEqual(product?.type === 'choice' && Object.keys(product.criteria), [
      'Pizza Broto (Pizzas)',
      'Pizza Grande (Pizzas)',
      'Coca-Cola 2L (Bebidas)',
      NONE_OF_THESE
    ]);
    deepEqual(payment?.type === 'choice' && Object.keys(payment.criteria), ['pix', 'cash', NOT_MENTIONED]);
    equal(Q_REMOVE in questions, false);
    equal(Q_REMOVE in plan(true).questions, true);
  });

  it('gives Jev the previous order in compact form', () => {
    const lastOrder: LastOrder = {
      order_id: 'o0',
      items: cart.items,
      total_cents: 1400,
      status: OrderStatus.Placed,
      minutes_ago: 5,
      editable: true,
      new_order_allowed: false,
      add_on: null
    };

    const withOrder = buildJevPlan({
      messages: ['esqueci a coca'],
      history: [],
      cart: undefined,
      candidates: menu,
      paymentMethods: [PaymentMethod.Pix],
      lastOrder
    });

    deepEqual((withOrder.state as { last_order: unknown }).last_order, {
      status: 'placed',
      items: ['1x Coca-Cola 2L']
    });
    equal((plan().state as { last_order: unknown }).last_order, null);
    equal(withOrder.questions[Q_PRANK]?.type, 'noul');
  });
});

describe('decideJevAction', () => {
  it('hands off when the customer asks for a person', () => {
    const decision = decide(plan(), {}, 0.93);

    equal(decision.kind === 'direct' && decision.tool, ToolName.CallHuman);
  });

  it('falls back when the intent is uncertain', () => {
    equal(decide(plan(), { [Q_INTENT]: [Intent.AddItem, 0.4] }).kind, 'fallback');
  });

  it('adds a single-flavor pizza with its options, skipping an optional group not mentioned', () => {
    const decision = decide(plan(), {
      [Q_INTENT]: [Intent.AddItem, 0.92],
      [Q_PRODUCT]: ['Pizza Broto (Pizzas)', 0.9],
      [Q_QTY]: ['2', 0.95],
      [groupQuestionId('g-sabor')]: ['Calabresa', 0.88]
    });

    deepEqual(decision, {
      kind: 'direct',
      intent: Intent.AddItem,
      confidence: 0.92,
      tool: ToolName.AddItem,
      args: { product_id: 'p-broto', qty: 2, selections: [{ group_id: 'g-sabor', option_ids: ['o-bcal'] }] }
    });
  });

  it('falls back when the message also sets fulfillment or payment (one direct tool would drop it)', () => {
    const addAndPickup = decide(plan(), {
      [Q_INTENT]: [Intent.AddItem, 0.82],
      [Q_PRODUCT]: ['Pizza Broto (Pizzas)', 0.9],
      [groupQuestionId('g-sabor')]: ['Calabresa', 0.88],
      [Q_FULFILLMENT]: [Fulfillment.Pickup, 0.9]
    });
    const payAndPickup = decide(plan(), {
      [Q_INTENT]: [Intent.SetPayment, 0.9],
      [Q_PAYMENT]: ['pix', 0.9],
      [Q_FULFILLMENT]: [Fulfillment.Pickup, 0.9]
    });
    const confirmAndPay = decide(plan(), { [Q_INTENT]: [Intent.Confirm, 0.9], [Q_PAYMENT]: ['pix', 0.9] });

    deepEqual(addAndPickup, { kind: 'fallback', reason: 'several_requests', intent: Intent.AddItem, confidence: 0.82 });
    equal(payAndPickup.kind === 'fallback' && payAndPickup.reason, 'several_requests');
    equal(confirmAndPay.kind === 'fallback' && confirmAndPay.reason, 'several_requests');
  });

  it('stays direct when the extra detail only repeats what the cart has', () => {
    const current = buildJevPlan({
      messages: ['sim, vou retirar, confirmo'],
      history: [],
      cart: { ...cart, fulfillment: Fulfillment.Pickup },
      candidates: menu,
      paymentMethods: [PaymentMethod.Pix]
    });
    const decision = decideJevAction(
      current,
      answers(current, { [Q_INTENT]: [Intent.Confirm, 0.9], [Q_FULFILLMENT]: [Fulfillment.Pickup, 0.9] }),
      { menu, text: 'sim, vou retirar, confirmo' }
    );

    equal(decision.kind === 'direct' && decision.tool, ToolName.PlaceOrder);
  });

  it('falls back when the customer adds a note to the item', () => {
    const current = plan();

    const withNote = answers(current, {
      [Q_INTENT]: [Intent.AddItem, 0.92],
      [Q_PRODUCT]: ['Pizza Broto (Pizzas)', 0.9],
      [Q_QTY]: ['1', 0.95],
      [groupQuestionId('g-sabor')]: ['Calabresa', 0.88]
    });

    withNote[Q_NOTES] = { type: 'noul', noul: 0.9 };

    const decision = decideJevAction(current, withNote, { menu, text: 'uma broto de calabresa sem cebola' });

    equal(decision.kind === 'fallback' && decision.reason, 'notes');
  });

  it('falls back for multi-flavor products and for a required option not mentioned', () => {
    const base = { [Q_INTENT]: [Intent.AddItem, 0.92] as [string, number], [Q_QTY]: ['1', 0.95] as [string, number] };

    equal(decide(plan(), { ...base, [Q_PRODUCT]: ['Pizza Grande (Pizzas)', 0.9] }).kind, 'fallback');
    equal(decide(plan(), { ...base, [Q_PRODUCT]: ['Pizza Broto (Pizzas)', 0.9] }).kind, 'fallback');
    equal(decide(plan(), { ...base, [Q_PRODUCT]: [NONE_OF_THESE, 0.9] }).kind, 'fallback');
  });

  it('adds a product without options', () => {
    const decision = decide(plan(), {
      [Q_INTENT]: [Intent.AddItem, 0.9],
      [Q_PRODUCT]: ['Coca-Cola 2L (Bebidas)', 0.9],
      [Q_QTY]: ['1', 0.9]
    });

    equal(
      decision.kind === 'direct' && JSON.stringify(decision.args),
      JSON.stringify({ product_id: 'p-coca', qty: 1, selections: [] })
    );
  });

  it('sets pix directly but sends cash (change amount) to the LLM', () => {
    const pix = decide(plan(), { [Q_INTENT]: [Intent.SetPayment, 0.9], [Q_PAYMENT]: ['pix', 0.9] });
    const cash = decide(plan(), { [Q_INTENT]: [Intent.SetPayment, 0.9], [Q_PAYMENT]: ['cash', 0.9] });

    deepEqual(pix.kind === 'direct' && pix.args, { method: 'pix' });
    equal(cash.kind, 'fallback');
  });

  it('maps the item to remove back to its id', () => {
    const current = plan(true);
    const decision = decide(current, { [Q_INTENT]: [Intent.RemoveItem, 0.9], [Q_REMOVE]: ['1x Coca-Cola 2L', 0.9] });

    deepEqual(decision.kind === 'direct' && decision.args, { item_id: 'i-1' });
  });

  it('confirms with place_order, searches on menu questions and falls back on free text', () => {
    const confirm = decide(plan(), { [Q_INTENT]: [Intent.Confirm, 0.9] });
    const ask = decide(plan(), { [Q_INTENT]: [Intent.AskMenu, 0.9] });

    equal(confirm.kind === 'direct' && confirm.tool, ToolName.PlaceOrder);
    deepEqual(ask.kind === 'direct' && ask.args, { query: 'quero uma broto de calabresa' });
    equal(decide(plan(), { [Q_INTENT]: [Intent.SetAddress, 0.95] }).kind, 'fallback');
    equal(decide(plan(), { [Q_INTENT]: [Intent.Other, 0.95] }).kind, 'fallback');
  });

  it('hands off a suspected prank, and ignores a low prank probability', () => {
    const current = plan();

    const prank = answers(current, { [Q_INTENT]: [Intent.AddItem, 0.9] });
    prank[Q_PRANK] = { type: 'noul', noul: 0.9 };

    const decision = decideJevAction(current, prank, { menu, text: 'quero 500 pizzas' });

    equal(decision.kind === 'direct' && decision.tool, ToolName.CallHuman);
    deepEqual(decision.kind === 'direct' && decision.args, { reason: 'suspected_prank' });

    prank[Q_PRANK] = { type: 'noul', noul: 0.3 };

    equal(decideJevAction(current, prank, { menu, text: 'quero pizza' }).kind, 'fallback');
  });
});
