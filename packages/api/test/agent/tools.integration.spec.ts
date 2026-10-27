import type { ToolContext } from '../../src/agent/tools';
import type { Db } from '../../src/db';
import type { Cart } from '../../src/orders/repository';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { executeTool, TOOL_DEFINITIONS, ToolName } from '../../src/agent/tools';
import { ConversationMode } from '../../src/conversations/types';
import { MenuRepository } from '../../src/menu/repository';
import { OrderRepository } from '../../src/orders/repository';
import { OrderStatus } from '../../src/orders/types';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { NewOrderAfterStatus, PaymentMethod } from '../../src/stores/types';
import { groupIdOf, optionIdOf, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('agent tools', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async (store: Parameters<typeof seedStore>[1] = {}) => {
    const { storeId } = await seedStore(db, store);
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);

    const ctx: ToolContext = { db, storeId, conversationId, customerId, menu, mutated: false };

    return { ctx, menu };
  };

  const cartOf = (result: Awaited<ReturnType<typeof executeTool>>) => {
    if (!result.ok) {
      throw new Error(`Tool failed: ${result.error}`);
    }

    return (result.data as { cart: Cart }).cart;
  };

  it('defines the spec tools plus the saved address and repeat order ones', () => {
    deepEqual(
      TOOL_DEFINITIONS.map(({ function: { name } }) => name),
      [
        ToolName.SearchMenu,
        ToolName.AddItem,
        ToolName.RemoveItem,
        ToolName.SetFulfillment,
        ToolName.SetAddress,
        ToolName.UseSavedAddress,
        ToolName.SetPayment,
        ToolName.GetCart,
        ToolName.PlaceOrder,
        ToolName.CallHuman,
        ToolName.RepeatPreviousOrder,
        ToolName.AddToOrder
      ]
    );
  });

  it('searches the menu and lists everything when nothing matches', async () => {
    const { ctx } = await setup();

    const found = await executeTool(ctx, ToolName.SearchMenu, { query: 'guarana' });
    const all = await executeTool(ctx, ToolName.SearchMenu, { query: 'oi' });

    const names = (result: typeof found) =>
      result.ok ? (result.data as { products: { name: string }[] }).products.map(({ name }) => name) : [];

    deepEqual(names(found), ['Guaraná Antarctica 2L']);
    equal(names(all).length, 4);
    equal(ctx.mutated, false);
  });

  it('adds an item with prices from the menu, ignoring any price the model sends', async () => {
    const { ctx, menu } = await setup();
    const broto = productByName(menu, 'Pizza Broto');

    const result = await executeTool(ctx, ToolName.AddItem, {
      product_id: broto.id,
      qty: 2,
      price_cents: 1,
      selections: [{ group_id: groupIdOf(broto, 'Sabor'), option_ids: [optionIdOf(broto, 'Sabor', 'Calabresa')] }]
    });

    const cart = cartOf(result);

    equal(cart.items[0]!.unit_price_cents, 2990);
    equal(cart.subtotal_cents, 5980);
    equal(ctx.mutated, true);
  });

  it('lists sold-out items flagged and refuses to add them without handing off', async () => {
    const { ctx, menu } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');
    const grande = productByName(menu, 'Pizza Broto');

    const item = await StockRepository.createItem(db, ctx.storeId, {
      name: 'Coca 2L',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, ctx.storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);

    const calabresa = optionIdOf(grande, 'Sabor', 'Calabresa');
    const flavor = await StockRepository.createItem(db, ctx.storeId, {
      name: 'Calabresa',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, ctx.storeId, { optionId: calabresa }, [{ stockItemId: flavor.id, qty: 1 }]);

    ctx.menu = await MenuRepository.load(db, ctx.storeId);

    const found = await executeTool(ctx, ToolName.SearchMenu, { query: 'coca' });
    const pizzas = await executeTool(ctx, ToolName.SearchMenu, { query: 'broto' });

    type View = { name: string; sold_out: boolean; groups: { options: { option_id: string; sold_out: boolean }[] }[] };

    const views = (result: typeof found) => (result.ok ? (result.data as { products: View[] }).products : []);

    equal(views(found).find(({ name }) => name === 'Coca-Cola 2L')?.sold_out, true);
    deepEqual(
      views(pizzas)
        .find(({ name }) => name === 'Pizza Broto')
        ?.groups[0]?.options.filter(({ sold_out }) => sold_out)
        .map(({ option_id }) => option_id),
      [calabresa]
    );

    const added = await executeTool(ctx, ToolName.AddItem, { product_id: coca.id, qty: 1 });
    const option = await executeTool(ctx, ToolName.AddItem, {
      product_id: grande.id,
      selections: [{ group_id: groupIdOf(grande, 'Sabor'), option_ids: [calabresa] }]
    });

    equal(added.ok ? 'ok' : added.error, 'sold_out');
    equal(option.ok ? 'ok' : option.error, 'option_sold_out');
    equal(ctx.mutated, false);
    equal(await db.conversations.count({ where: { id: ctx.conversationId, mode: ConversationMode.Human } }), 0);
  });

  it('returns errors to the model instead of throwing, and does not flag a change', async () => {
    const { ctx, menu } = await setup();
    const grande = productByName(menu, 'Pizza Grande');

    const missingArg = await executeTool(ctx, ToolName.AddItem, { qty: 1 });
    const unknownProduct = await executeTool(ctx, ToolName.AddItem, { product_id: 'nope' });
    const belowMin = await executeTool(ctx, ToolName.AddItem, { product_id: grande.id, selections: [] });
    const badSelections = await executeTool(ctx, ToolName.AddItem, { product_id: grande.id, selections: 'calabresa' });
    const garbageItem = await executeTool(ctx, ToolName.RemoveItem, { item_id: 'item-1' });
    const badEnum = await executeTool(ctx, ToolName.SetFulfillment, { fulfillment: 'drone' });
    const notArgs = await executeTool(ctx, ToolName.SetAddress, undefined);
    const unknownTool = await executeTool(ctx, 'make_pizza', {});

    const errors = [
      missingArg,
      unknownProduct,
      belowMin,
      badSelections,
      garbageItem,
      badEnum,
      notArgs,
      unknownTool
    ].map((result) => (result.ok ? 'ok' : result.error));

    deepEqual(errors, [
      'invalid_arguments',
      'unknown_product',
      'below_min',
      'invalid_arguments',
      'no_draft',
      'invalid_arguments',
      'invalid_arguments',
      'unknown_tool'
    ]);
    equal(ctx.mutated, false);
  });

  it('rejects a non-UUID item id once a draft exists', async () => {
    const { ctx, menu } = await setup();

    await executeTool(ctx, ToolName.AddItem, { product_id: productByName(menu, 'Coca-Cola 2L').id });

    const result = await executeTool(ctx, ToolName.RemoveItem, { item_id: 'item-1' });

    equal(result.ok ? 'ok' : result.error, 'item_not_found');
  });

  it('runs a full order through the tools', async () => {
    const { ctx, menu } = await setup();

    await executeTool(ctx, ToolName.AddItem, { product_id: productByName(menu, 'Coca-Cola 2L').id, qty: 1 });
    await executeTool(ctx, ToolName.SetAddress, { address: 'Rua A, 10', neighborhood: 'Centro' });
    await executeTool(ctx, ToolName.SetPayment, { method: 'pix' });

    const cart = cartOf(await executeTool(ctx, ToolName.GetCart, {}));

    deepEqual(cart.missing, []);

    const placed = cartOf(await executeTool(ctx, ToolName.PlaceOrder, {}));

    equal(placed.status, 'placed');

    // The placed order stays the current one while the store has not accepted it.
    equal(cartOf(await executeTool(ctx, ToolName.GetCart, {})).status, 'placed');
  });

  const placeCoke = async (ctx: ToolContext, menu: Awaited<ReturnType<typeof seedMenu>>) => {
    await executeTool(ctx, ToolName.AddItem, { product_id: productByName(menu, 'Coca-Cola 2L').id, qty: 1 });
    await executeTool(ctx, ToolName.SetAddress, { address: 'Rua A, 10', neighborhood: 'Centro' });
    await executeTool(ctx, ToolName.SetPayment, { method: 'pix' });

    return cartOf(await executeTool(ctx, ToolName.PlaceOrder, {})).order_id;
  };

  const broto = (menu: Awaited<ReturnType<typeof seedMenu>>) => {
    const product = productByName(menu, 'Pizza Broto');

    return {
      product_id: product.id,
      qty: 1,
      selections: [{ group_id: groupIdOf(product, 'Sabor'), option_ids: [optionIdOf(product, 'Sabor', 'Calabresa')] }]
    };
  };

  it('edits the placed order before the store accepts it and opens a new order only once it is done (default)', async () => {
    const { ctx, menu } = await setup();
    const orderId = await placeCoke(ctx, menu);
    const guarana = { product_id: productByName(menu, 'Guaraná Antarctica 2L').id, qty: 1 };

    const early = await executeTool(ctx, ToolName.AddToOrder, guarana);

    equal(early.ok, false);
    equal(!early.ok && early.error, 'no_order_in_progress');
    equal(cartOf(await executeTool(ctx, ToolName.AddItem, broto(menu))).order_id, orderId);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    const waiting = await executeTool(ctx, ToolName.AddItem, broto(menu));

    equal(!waiting.ok && waiting.error, 'previous_order_open');

    await db.orders.updateOne({ data: { status: OrderStatus.Done }, where: { id: orderId } });

    const next = cartOf(await executeTool(ctx, ToolName.AddItem, guarana));

    equal(next.status, OrderStatus.Draft);
    equal(next.order_id !== orderId, true);
  });

  it('adds only add-on categories to an order being prepared and waits for the store status to start another', async () => {
    const { ctx, menu } = await setup({
      policy: { new_order_after_status: NewOrderAfterStatus.Out, add_on_extra_minutes: 15 }
    });

    const orderId = await placeCoke(ctx, menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    ctx.mutated = false;

    const added = await executeTool(ctx, ToolName.AddToOrder, {
      product_id: productByName(menu, 'Guaraná Antarctica 2L').id,
      qty: 2
    });

    equal(added.ok, true);
    equal(ctx.mutated, true);

    const { cart, extra_minutes } = (added.ok ? added.data : {}) as { cart: Cart; extra_minutes: number };

    equal(cart.order_id, orderId);
    equal(cart.status, OrderStatus.Accepted);
    equal(cart.subtotal_cents, 1400 + 2 * 1200);
    equal(extra_minutes, 15);
    equal(!!(await db.orders.findOne({ select: { amended_at: true }, where: { id: orderId } }))?.amended_at, true);

    const pizza = await executeTool(ctx, ToolName.AddToOrder, broto(menu));

    equal(!pizza.ok && pizza.error, 'not_allowed_after_accept');
    equal(!pizza.ok && pizza.message.includes('Bebidas'), true);

    const separate = await executeTool(ctx, ToolName.AddItem, broto(menu));

    equal(!separate.ok && separate.error, 'previous_order_open');

    await db.orders.updateOne({ data: { status: OrderStatus.Out }, where: { id: orderId } });

    const late = await executeTool(ctx, ToolName.AddToOrder, {
      product_id: productByName(menu, 'Coca-Cola 2L').id,
      qty: 1
    });

    equal(!late.ok && late.error, 'no_order_in_progress');
    equal(cartOf(await executeTool(ctx, ToolName.AddItem, broto(menu))).status, OrderStatus.Draft);
  });

  it('takes no add-on when the store allows no category', async () => {
    const { ctx, menu } = await setup({ policy: { add_on_category_ids: [] } });
    const orderId = await placeCoke(ctx, menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    const result = await executeTool(ctx, ToolName.AddToOrder, {
      product_id: productByName(menu, 'Coca-Cola 2L').id,
      qty: 1
    });

    equal(!result.ok && result.error, 'not_allowed_after_accept');
  });

  it('hands the conversation to a human', async () => {
    const { ctx } = await setup();

    const result = await executeTool(ctx, ToolName.CallHuman, { reason: 'customer_complaint' });

    const conversation = await db.conversations.findOne({
      select: { mode: true, handoff_reason: true },
      where: { id: ctx.conversationId }
    });

    deepEqual(result, { ok: true, data: { handed_off: true } });
    equal(conversation?.mode, ConversationMode.Human);
    equal(conversation?.handoff_reason, 'customer_complaint');
    equal(ctx.mutated, true);
  });

  const conversationOf = (conversationId: string) =>
    db.conversations.findOne({
      select: { mode: true, handoff_reason: true, approval_reason: true },
      where: { id: conversationId }
    });

  it('asks the store to approve a limit instead of handing off, and tells the model', async () => {
    const { ctx, menu } = await setup({ policy: { max_item_qty: 5 } });

    const result = await executeTool(ctx, ToolName.AddItem, {
      product_id: productByName(menu, 'Coca-Cola 2L').id,
      qty: 20
    });

    equal(result.ok ? 'ok' : result.error, 'needs_human');
    equal(ctx.mutated, true);
    equal(ctx.awaitingApproval, true);

    const conversation = await conversationOf(ctx.conversationId);

    // The bot waits for the store: still bot mode, nothing billed.
    equal(conversation?.mode, ConversationMode.Bot);
    equal(conversation?.approval_reason, 'qty_limit');
    equal(await db.billing_records.count({ where: { conversation_id: ctx.conversationId } }), 0);
  });

  it('goes over the limits the store approved', async () => {
    const { ctx, menu } = await setup({ policy: { max_item_qty: 5, max_order_cents: 3000 } });

    ctx.approvedReason = 'qty_limit';

    const result = await executeTool(ctx, ToolName.AddItem, {
      product_id: productByName(menu, 'Coca-Cola 2L').id,
      qty: 20
    });

    equal(cartOf(result).items[0]?.qty, 20);
    equal(ctx.awaitingApproval, undefined);
  });

  it('places a large first order and asks the store to review it', async () => {
    const { ctx, menu } = await setup({ policy: { new_customer_review_cents: 1000 } });

    await executeTool(ctx, ToolName.AddItem, { product_id: productByName(menu, 'Coca-Cola 2L').id, qty: 1 });
    await executeTool(ctx, ToolName.SetFulfillment, { fulfillment: 'pickup' });
    await executeTool(ctx, ToolName.SetPayment, { method: 'pix' });

    const result = await executeTool(ctx, ToolName.PlaceOrder, {});

    equal(result.ok && (result.data as { handed_off?: boolean }).handed_off, true);
    equal(cartOf(result).status, 'placed');
    equal((await conversationOf(ctx.conversationId))?.approval_reason, 'new_customer_review');
  });

  it('refuses every tool after the conversation was handed to a human', async () => {
    const { ctx, menu } = await setup({ policy: { max_item_qty: 5 } });
    const coca = productByName(menu, 'Coca-Cola 2L').id;

    await executeTool(ctx, ToolName.AddItem, { product_id: coca, qty: 20 });

    const retry = await executeTool(ctx, ToolName.AddItem, { product_id: coca, qty: 5 });
    const call = await executeTool(ctx, ToolName.CallHuman, { reason: 'other' });

    equal(retry.ok ? 'ok' : retry.error, 'needs_human');
    equal(call.ok ? 'ok' : call.error, 'needs_human');
    equal(await OrderRepository.findDraftId(db, ctx.conversationId), undefined);
    equal((await conversationOf(ctx.conversationId))?.approval_reason, 'qty_limit');
  });

  /**
   * A finished delivery order of the same customer in another conversation of the store.
   */
  const previousDelivery = async (ctx: ToolContext, menu: Awaited<ReturnType<typeof seedMenu>>) => {
    const { conversationId } = await seedConversation(db, ctx.storeId);
    const scope = { storeId: ctx.storeId, conversationId, customerId: ctx.customerId };
    const pizza = productByName(menu, 'Pizza Broto');

    await OrderRepository.addItem(db, scope, {
      product: pizza,
      qty: 2,
      selections: [{ group_id: groupIdOf(pizza, 'Sabor'), option_ids: [optionIdOf(pizza, 'Sabor', 'Calabresa')] }],
      notes: 'bem assada'
    });
    await OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });
    await OrderRepository.setAddress(db, scope, { address: 'Rua das Flores, 10', neighborhood: 'Centro' });
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const { order_id } = await OrderRepository.place(db, scope);

    await db.orders.updateOne({ data: { status: OrderStatus.Done }, where: { id: order_id } });
  };

  it('delivers to the saved address of the previous order', async () => {
    const { ctx, menu } = await setup();

    const none = await executeTool(ctx, ToolName.UseSavedAddress, {});

    equal(none.ok ? 'ok' : none.error, 'no_saved_address');

    await previousDelivery(ctx, menu);

    const cart = cartOf(await executeTool(ctx, ToolName.UseSavedAddress, {}));

    equal(cart.fulfillment, 'delivery');
    equal(cart.address, 'Rua das Flores, 10');
    equal(cart.neighborhood, 'Centro');
  });

  it("repeats the previous order with today's prices when its status is allowed, skipping what left the menu", async () => {
    const { ctx, menu } = await setup({ policy: { repeat_order_statuses: [OrderStatus.Canceled] } });

    await previousDelivery(ctx, menu);

    const refused = await executeTool(ctx, ToolName.RepeatPreviousOrder, {});

    equal(refused.ok ? 'ok' : refused.error, 'no_previous_order');

    await db.stores.updateOne({
      data: { policy: { repeat_order_statuses: [OrderStatus.Done] } },
      where: { id: ctx.storeId }
    });

    // The Coca-Cola left the menu since then.
    ctx.menu = menu.filter(({ name }) => name !== 'Coca-Cola 2L');

    const result = await executeTool(ctx, ToolName.RepeatPreviousOrder, {});
    const cart = cartOf(result);

    deepEqual(
      cart.items.map(({ name, qty, notes }) => ({ name, qty, notes })),
      [{ name: 'Pizza Broto', qty: 2, notes: 'bem assada' }]
    );
    deepEqual((result.ok && (result.data as { skipped: string[] }).skipped) || [], ['Coca-Cola 2L']);
    equal(ctx.mutated, true);
  });

  it('repeats what it can when a line runs out of stock on the placed order, and flags the turn as mutated', async () => {
    const { ctx, menu } = await setup({ policy: { repeat_order_statuses: [OrderStatus.Done] } });

    await previousDelivery(ctx, menu);

    // The customer's current order is a placed one (a Guaraná), so the repeated lines are edits to it.
    await executeTool(ctx, ToolName.AddItem, { product_id: productByName(menu, 'Guaraná Antarctica 2L').id, qty: 1 });
    await executeTool(ctx, ToolName.SetAddress, { address: 'Rua A, 10', neighborhood: 'Centro' });
    await executeTool(ctx, ToolName.SetPayment, { method: 'pix' });

    const placed = cartOf(await executeTool(ctx, ToolName.PlaceOrder, {}));

    const stocked = async (name: string, balance: number) => {
      const item = await StockRepository.createItem(db, ctx.storeId, {
        name,
        unit: StockUnit.Unit,
        barcode: null,
        minQty: null
      });

      await StockRepository.setLinks(db, ctx.storeId, { productId: productByName(menu, name).id }, [
        { stockItemId: item.id, qty: 1 }
      ]);

      if (balance > 0) {
        await StockRepository.recordEntry(db, ctx.storeId, { itemId: item.id, qty: balance, author: 'test' });
      }
    };

    await stocked('Pizza Broto', 100);
    await stocked('Coca-Cola 2L', 0);

    ctx.mutated = false;

    const result = await executeTool(ctx, ToolName.RepeatPreviousOrder, {});
    const cart = cartOf(result);

    equal(cart.order_id, placed.order_id);
    deepEqual(
      cart.items.map(({ name, qty }) => ({ name, qty })),
      [
        { name: 'Guaraná Antarctica 2L', qty: 1 },
        { name: 'Pizza Broto', qty: 2 }
      ]
    );
    deepEqual((result.ok && (result.data as { skipped: string[] }).skipped) || [], ['Coca-Cola 2L']);
    equal(ctx.mutated, true);
  });
});
