import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode } from '../../src/conversations/types';
import { addDraftItemHandler } from '../../src/panel/endpoints/add-draft-item';
import { getDraftHandler } from '../../src/panel/endpoints/get-draft';
import { placeDraftHandler } from '../../src/panel/endpoints/place-draft';
import { removeDraftItemHandler } from '../../src/panel/endpoints/remove-draft-item';
import { updateDraftHandler } from '../../src/panel/endpoints/update-draft';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { groupIdOf, optionIdOf, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('attendant order (panel draft)', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, {
      policy: { max_item_qty: 1, new_customer_review_cents: 100, last_order_minutes: 24 * 60 }
    });

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const menu = await seedMenu(db, storeId);
    const { conversationId } = await seedConversation(db, storeId);
    const identity = { userId: 'user_1', orgId };
    const parameters = { conversationId };

    return { identity, parameters, menu, conversationId };
  };

  it('refuses to touch the order while the bot handles the conversation', async () => {
    const { identity, parameters } = await setup();

    await rejects(getDraftHandler({ identity, parameters } as never, { db }), HttpConflictError);
  });

  it('builds and places an order without the bot limits, review or billing', async () => {
    const { identity, parameters, menu, conversationId } = await setup();

    await ConversationRepository.setMode(db, {
      conversationId,
      mode: ConversationMode.Human,
      reason: 'staff_took_over'
    });

    const empty = await getDraftHandler({ identity, parameters } as never, { db });

    deepEqual(empty.body, { cart: null, savedAddress: null });

    const broto = productByName(menu, 'Pizza Broto');
    const add = (body: Record<string, unknown>) => addDraftItemHandler({ identity, parameters, body } as never, { db });

    await add({
      productId: broto.id,
      qty: 1,
      selections: [{ groupId: groupIdOf(broto, 'Sabor'), optionIds: [optionIdOf(broto, 'Sabor', 'Calabresa')] }],
      notes: ' sem cebola '
    });

    // Above the store's max_item_qty: the store itself decides.
    const added = await add({ productId: productByName(menu, 'Coca-Cola 2L').id, qty: 3, selections: [] });

    deepEqual(
      added.body.cart.items.map(({ name, qty, notes }) => ({ name, qty, notes })),
      [
        { name: 'Pizza Broto', qty: 1, notes: 'sem cebola' },
        { name: 'Coca-Cola 2L', qty: 3, notes: null }
      ]
    );

    await rejects(add({ productId: randomUUID(), qty: 1, selections: [] }), HttpBadRequestError);

    const removed = await removeDraftItemHandler(
      { identity, parameters: { ...parameters, itemId: added.body.cart.items[1]!.itemId } } as never,
      { db }
    );

    equal(removed.body.cart.items.length, 1);

    const update = (body: Record<string, unknown>) =>
      updateDraftHandler({ identity, parameters, body } as never, { db });

    await update({ fulfillment: 'pickup' });

    const paid = await update({ payment: { method: 'pix' } });

    deepEqual(paid.body.cart.missing, []);

    // Inside the closing cutoff and above the new-customer review: both are for the bot only.
    const placed = await placeDraftHandler({ identity, parameters } as never, { db });

    equal(placed.body.cart.orderId, removed.body.cart.orderId);

    const order = await db.orders.findOne({ select: { status: true }, where: { id: placed.body.cart.orderId } });

    equal(order?.status, 'placed');
    equal(await db.billing_records.count({ where: { conversation_id: conversationId } }), 0);
  });

  it('lets the attendant add a product whose required option is sold out', async () => {
    const { identity, parameters, menu, conversationId } = await setup();
    const storeId = (await db.conversations.findOne({ select: { store_id: true }, where: { id: conversationId } }))!
      .store_id;

    await ConversationRepository.setMode(db, {
      conversationId,
      mode: ConversationMode.Human,
      reason: 'staff_took_over'
    });

    const broto = productByName(menu, 'Pizza Broto');
    const calabresa = optionIdOf(broto, 'Sabor', 'Calabresa');

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Calabresa',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { optionId: calabresa }, [{ stockItemId: item.id, qty: 1 }]);

    const added = await addDraftItemHandler(
      {
        identity,
        parameters,
        body: {
          productId: broto.id,
          qty: 1,
          selections: [{ groupId: groupIdOf(broto, 'Sabor'), optionIds: [calabresa] }]
        }
      } as never,
      { db }
    );

    equal(added.body.cart.items.length, 1);
  });

  it('reports what placing still needs as a 400 with the error code', async () => {
    const { identity, parameters, menu, conversationId } = await setup();

    await ConversationRepository.setMode(db, {
      conversationId,
      mode: ConversationMode.Human,
      reason: 'staff_took_over'
    });
    await addDraftItemHandler(
      {
        identity,
        parameters,
        body: { productId: productByName(menu, 'Coca-Cola 2L').id, qty: 1, selections: [] }
      } as never,
      { db }
    );

    await rejects(placeDraftHandler({ identity, parameters } as never, { db }), (error: HttpBadRequestError) => {
      deepEqual(error.context, { field: 'incomplete' });
      return true;
    });
  });
});
