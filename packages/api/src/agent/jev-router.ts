import type { JevAnswer, JevQuestion } from './jev-client';
import type { HistoryMessage, LastOrder } from './prompt';
import type { MenuProduct } from '../menu/repository';
import type { Selection } from '../orders/pricing';
import type { Cart } from '../orders/repository';

import { ToolName } from './tools';
import { Fulfillment } from '../orders/types';
import { PaymentMethod } from '../stores/types';

/**
 * Starting thresholds (spec: "tuned from logged data").
 */
export const JEV_MIN_CONFIDENCE = 0.6;

export const HANDOFF_MIN_PROBABILITY = 0.8;

/**
 * Above this, the customer added a note to the item (free text): the LLM writes it.
 */
export const NOTES_MAX_PROBABILITY = 0.5;

export const MAX_PRODUCT_CANDIDATES = 8;

export const MAX_GROUP_PRODUCTS = 3;

export const NOT_MENTIONED = 'not mentioned';

export const NONE_OF_THESE = 'none of these';

export const Q_INTENT = 'intent';
export const Q_HUMAN = 'wants_human';
export const Q_PRODUCT = 'product';
export const Q_QTY = 'qty';
export const Q_FULFILLMENT = 'fulfillment';
export const Q_PAYMENT = 'payment';
export const Q_REMOVE = 'remove_item';
export const Q_NOTES = 'item_notes';
export const Q_PRANK = 'looks_like_prank';

export const groupQuestionId = (groupId: string) => `group:${groupId}`;

const OTHER_QTY = 'other';

export const enum Intent {
  AddItem = 'add_item',
  RemoveItem = 'remove_item',
  AskMenu = 'ask_menu',
  SetAddress = 'set_address',
  SetPayment = 'set_payment',
  SetFulfillment = 'set_fulfillment',
  Confirm = 'confirm',
  Cancel = 'cancel',
  Human = 'human',
  Other = 'other'
}

const INTENT_CRITERIA: Record<Intent, string> = {
  [Intent.AddItem]: 'Orders one product to add to the order, including something forgotten in `last_order`.',
  [Intent.RemoveItem]: 'Wants to remove an item that is already in `cart`.',
  [Intent.AskMenu]: 'Asks what is available, flavors or prices, without ordering yet.',
  [Intent.SetAddress]: 'Gives or changes the delivery address.',
  [Intent.SetPayment]: 'Says how they will pay.',
  [Intent.SetFulfillment]: 'Says whether it is delivery or pickup at the store.',
  [Intent.Confirm]: 'Confirms the order summary and wants to place the order.',
  [Intent.Cancel]: 'Wants to cancel the order.',
  [Intent.Human]: 'Asks to talk to a person.',
  [Intent.Other]: 'Anything else: greetings, questions about the store, several requests at once, or unclear messages.'
};

const PAYMENT_CRITERIA: Record<PaymentMethod, string> = {
  [PaymentMethod.Pix]: 'Pays with Pix.',
  [PaymentMethod.Card]: 'Pays with a credit or debit card.',
  [PaymentMethod.Cash]: 'Pays with cash (dinheiro).'
};

export type JevPlan = {
  state: unknown;
  questions: Record<string, JevQuestion>;
  /**
   * Choice key → product (keys are what the model sees).
   */
  products: Map<string, MenuProduct>;
  /**
   * Products whose single-choice groups were asked.
   */
  groupProducts: Set<string>;
  /**
   * Choice key → cart item id.
   */
  items: Map<string, string>;
};

export type JevDecision =
  | { kind: 'direct'; intent: Intent; confidence: number; tool: ToolName; args: Record<string, unknown> }
  | { kind: 'fallback'; reason: string; intent?: Intent; confidence?: number };

const uniqueKey = (taken: Map<string, unknown>, key: string) => {
  let candidate = key;

  for (let index = 2; taken.has(candidate); index++) {
    candidate = `${key} #${index}`;
  }

  return candidate;
};

const choice = (instructions: string, criteria: Record<string, string | null>): JevQuestion => ({
  type: 'choice',
  instructions,
  criteria
});

const itemLabel = (item: Cart['items'][number]) =>
  `${item.qty}x ${item.name}${item.options ? ` (${item.options})` : ''}`;

export const buildJevPlan = (input: {
  messages: string[];
  history: HistoryMessage[];
  cart: Cart | undefined;
  candidates: MenuProduct[];
  paymentMethods: PaymentMethod[];
  lastOrder?: LastOrder | null;
}): JevPlan => {
  const products = new Map<string, MenuProduct>();

  for (const product of input.candidates) {
    products.set(uniqueKey(products, `${product.name} (${product.category})`), product);
  }

  const questions: Record<string, JevQuestion> = {
    [Q_INTENT]: choice(
      'What does the customer want with `new_messages`, given `recent_history` and `cart`?',
      INTENT_CRITERIA
    ),
    [Q_HUMAN]: {
      type: 'noul',
      instructions: 'In `new_messages`, does the customer ask to talk to a person or attendant?'
    },
    [Q_NOTES]: {
      type: 'noul',
      instructions:
        'In `new_messages`, does the customer ask for a change or note on an item (e.g. without onion, well done, extra sauce)?'
    },
    [Q_PRANK]: {
      type: 'noul',
      instructions:
        'Do `new_messages` look like a prank or a fake order (absurd quantities, jokes, insults, an order nobody would really place)?'
    },
    [Q_FULFILLMENT]: choice('Do `new_messages` say whether the order is delivery or pickup?', {
      [Fulfillment.Delivery]: 'Delivery to an address.',
      [Fulfillment.Pickup]: 'The customer picks it up at the store.',
      [NOT_MENTIONED]: null
    }),
    [Q_PAYMENT]: choice('Which payment method do `new_messages` choose?', {
      ...Object.fromEntries(input.paymentMethods.map((method) => [method, PAYMENT_CRITERIA[method]])),
      [NOT_MENTIONED]: null
    })
  };

  if (products.size) {
    questions[Q_PRODUCT] = choice('Which menu product do `new_messages` order or refer to?', {
      ...Object.fromEntries([...products.keys()].map((key) => [key, null])),
      [NONE_OF_THESE]: 'No product listed here, or no product mentioned.'
    });

    questions[Q_QTY] = choice('How many units of that product does the customer want in `new_messages`?', {
      '1': 'One unit, or quantity not stated.',
      '2': null,
      '3': null,
      '4': null,
      '5': null,
      [OTHER_QTY]: 'More than five, or different quantities for different products.'
    });
  }

  const groupProducts = new Set<string>();

  for (const product of input.candidates.slice(0, MAX_GROUP_PRODUCTS)) {
    groupProducts.add(product.id);

    for (const group of product.groups) {
      const options = group.options.filter(({ active }) => active);

      if (group.max > 1 || !options.length) {
        continue;
      }

      questions[groupQuestionId(group.id)] = choice(
        `If the customer orders ${product.name}, which "${group.name}" option do \`new_messages\` choose?`,
        {
          ...Object.fromEntries(options.map(({ name }) => [name, null])),
          [NOT_MENTIONED]: 'No option of this group is mentioned.'
        }
      );
    }
  }

  const items = new Map<string, string>();

  for (const item of input.cart?.items ?? []) {
    items.set(uniqueKey(items, itemLabel(item)), item.item_id);
  }

  if (items.size) {
    questions[Q_REMOVE] = choice('Which `cart` item do `new_messages` want to remove?', {
      ...Object.fromEntries([...items.keys()].map((key) => [key, null])),
      [NONE_OF_THESE]: 'No item, or not about removing.'
    });
  }

  return {
    state: {
      new_messages: input.messages,
      recent_history: input.history.slice(-4),
      cart: input.cart?.items.map(itemLabel) ?? [],
      last_order: input.lastOrder
        ? { status: input.lastOrder.status, items: input.lastOrder.items.map(itemLabel) }
        : null
    },
    questions,
    products,
    groupProducts,
    items
  };
};

const confidentChoice = (answers: Record<string, JevAnswer>, id: string) => {
  const answer = answers[id];

  return answer?.type === 'choice' && answer.confidence >= JEV_MIN_CONFIDENCE ? answer.choice : undefined;
};

const decideAddItem = (plan: JevPlan, answers: Record<string, JevAnswer>) => {
  // Notes are free text: Jev cannot copy them into the item.
  const notes = answers[Q_NOTES];

  if (notes?.type !== 'noul' || notes.noul > NOTES_MAX_PROBABILITY) {
    return 'notes';
  }

  const product = plan.products.get(confidentChoice(answers, Q_PRODUCT) ?? '');

  if (!product) {
    return 'product';
  }

  const qty = Number(confidentChoice(answers, Q_QTY));

  if (!Number.isInteger(qty) || qty < 1) {
    return 'qty';
  }

  const selections: Selection[] = [];

  for (const group of product.groups) {
    // Multi-select groups (half-and-half) and products whose groups were not asked go to the LLM.
    if (group.max > 1 || !plan.groupProducts.has(product.id)) {
      return 'options';
    }

    const answer = confidentChoice(answers, groupQuestionId(group.id));

    if (answer === undefined) {
      return 'options';
    }

    if (answer === NOT_MENTIONED) {
      if (group.min > 0) {
        return 'required_option_missing';
      }

      continue;
    }

    const option = group.options.find(({ name, active }) => active && name === answer);

    if (!option) {
      return 'options';
    }

    selections.push({ group_id: group.id, option_ids: [option.id] });
  }

  return { product_id: product.id, qty, selections };
};

/**
 * Code decides from Jev's typed answers whether one tool can run directly. Anything uncertain, free-text or
 * multi-step falls back to the full LLM agent.
 */
export const decideJevAction = (
  plan: JevPlan,
  answers: Record<string, JevAnswer>,
  input: { menu: MenuProduct[]; text: string }
): JevDecision => {
  const human = answers[Q_HUMAN];

  if (human?.type === 'noul' && human.noul >= HANDOFF_MIN_PROBABILITY) {
    return {
      kind: 'direct',
      intent: Intent.Human,
      confidence: human.noul,
      tool: ToolName.CallHuman,
      args: { reason: 'customer_asked' }
    };
  }

  const prank = answers[Q_PRANK];

  if (prank?.type === 'noul' && prank.noul >= HANDOFF_MIN_PROBABILITY) {
    return {
      kind: 'direct',
      intent: Intent.Human,
      confidence: prank.noul,
      tool: ToolName.CallHuman,
      args: { reason: 'suspected_prank' }
    };
  }

  const intentAnswer = answers[Q_INTENT];

  if (intentAnswer?.type !== 'choice') {
    return { kind: 'fallback', reason: 'no_intent' };
  }

  const intent = intentAnswer.choice as Intent;
  const { confidence } = intentAnswer;

  const direct = (tool: ToolName, args: Record<string, unknown>): JevDecision => ({
    kind: 'direct',
    intent,
    confidence,
    tool,
    args
  });

  const fallback = (reason: string): JevDecision => ({ kind: 'fallback', reason, intent, confidence });

  if (confidence < JEV_MIN_CONFIDENCE) {
    return fallback('low_confidence');
  }

  switch (intent) {
    case Intent.AddItem: {
      const args = decideAddItem(plan, answers);

      return typeof args === 'string' ? fallback(args) : direct(ToolName.AddItem, args);
    }

    case Intent.RemoveItem: {
      const itemId = plan.items.get(confidentChoice(answers, Q_REMOVE) ?? '');

      return itemId ? direct(ToolName.RemoveItem, { item_id: itemId }) : fallback('item');
    }

    case Intent.AskMenu:
      return direct(ToolName.SearchMenu, { query: input.text });

    case Intent.SetFulfillment: {
      const fulfillment = confidentChoice(answers, Q_FULFILLMENT);

      return fulfillment === Fulfillment.Delivery || fulfillment === Fulfillment.Pickup
        ? direct(ToolName.SetFulfillment, { fulfillment })
        : fallback('fulfillment');
    }

    case Intent.SetPayment: {
      const method = confidentChoice(answers, Q_PAYMENT);

      // Cash needs the change amount (free text): the LLM asks for it.
      return method === PaymentMethod.Pix || method === PaymentMethod.Card
        ? direct(ToolName.SetPayment, { method })
        : fallback('payment');
    }

    case Intent.Confirm:
      return direct(ToolName.PlaceOrder, {});

    case Intent.Human:
      return direct(ToolName.CallHuman, { reason: 'customer_asked' });

    default:
      return fallback('free_text');
  }
};
