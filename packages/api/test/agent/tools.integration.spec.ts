import type { ToolContext } from '../../src/agent/tools';
import type { Db } from '../../src/db';
import type { Cart } from '../../src/orders/repository';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { executeTool, TOOL_DEFINITIONS, ToolName } from '../../src/agent/tools';
import { ConversationMode } from '../../src/conversations/types';
import { OrderRepository } from '../../src/orders/repository';
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

  it('defines the nine spec tools', () => {
    deepEqual(
      TOOL_DEFINITIONS.map(({ function: { name } }) => name),
      [
        ToolName.SearchMenu,
        ToolName.AddItem,
        ToolName.RemoveItem,
        ToolName.SetFulfillment,
        ToolName.SetAddress,
        ToolName.SetPayment,
        ToolName.GetCart,
        ToolName.PlaceOrder,
        ToolName.CallHuman
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
    db.conversations.findOne({ select: { mode: true, handoff_reason: true }, where: { id: conversationId } });

  it('hands off when a store limit needs a human and tells the model', async () => {
    const { ctx, menu } = await setup({ policy: { max_item_qty: 5 } });

    const result = await executeTool(ctx, ToolName.AddItem, {
      product_id: productByName(menu, 'Coca-Cola 2L').id,
      qty: 20
    });

    equal(result.ok ? 'ok' : result.error, 'needs_human');
    equal(ctx.mutated, true);

    const conversation = await conversationOf(ctx.conversationId);

    equal(conversation?.mode, ConversationMode.Human);
    equal(conversation?.handoff_reason, 'qty_limit');
  });

  it('places a large first order and hands it to a human for review', async () => {
    const { ctx, menu } = await setup({ policy: { new_customer_review_cents: 1000 } });

    await executeTool(ctx, ToolName.AddItem, { product_id: productByName(menu, 'Coca-Cola 2L').id, qty: 1 });
    await executeTool(ctx, ToolName.SetFulfillment, { fulfillment: 'pickup' });
    await executeTool(ctx, ToolName.SetPayment, { method: 'pix' });

    const result = await executeTool(ctx, ToolName.PlaceOrder, {});

    equal(result.ok && (result.data as { handed_off?: boolean }).handed_off, true);
    equal(cartOf(result).status, 'placed');
    equal((await conversationOf(ctx.conversationId))?.handoff_reason, 'new_customer_review');
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
    equal((await conversationOf(ctx.conversationId))?.handoff_reason, 'qty_limit');
  });
});
