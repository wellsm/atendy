import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { CashRepository } from '../../src/cash/repository';
import { MessageAuthor } from '../../src/conversations/types';
import { finalizePosSaleHandler } from '../../src/pos/endpoints/finalize-sale';
import { sendPosReceiptHandler } from '../../src/pos/endpoints/send-receipt';
import { PosRepository } from '../../src/pos/repository';
import { PaymentMethod } from '../../src/stores/types';
import { EvolutionRequestError } from '../../src/whatsapp/evolution-client';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { productByName, seedMenu, seedStore } from '../support/fixtures';

describe('pos receipt', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  afterEach(() => mock.restoreAll());

  const paidSale = async (phone: string | null) => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Cash] });
    const coca = productByName(await seedMenu(db, storeId), 'Coca-Cola 2L');
    const identity = { userId: 'user_1', orgId };

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });
    await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });

    const { id } = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'user_1' });

    await PosRepository.addLine(db, storeId, id, { product: coca, qty: 1, selections: [] });

    if (phone) {
      await PosRepository.updateSale(db, storeId, id, { customer: { name: 'Ana', phone } });
    }

    await finalizePosSaleHandler(
      {
        identity,
        parameters: { saleId: id },
        body: { payments: [{ method: PaymentMethod.Cash, amountCents: coca.price_cents, receivedCents: 10000 }] }
      } as never,
      { db, panelEvents }
    );

    return { storeId, saleId: id, identity };
  };

  const send = (identity: { userId: string; orgId: string }, saleId: string) =>
    sendPosReceiptHandler({ identity, parameters: { saleId } } as never, { db, panelEvents });

  it('sends the receipt as a staff message and keeps the sale out of the conversation', async () => {
    const sent: { to: string; text: string }[] = [];

    mock.method(WhatsAppProviders, 'forStore', () => ({
      sendText: (input: { to: string; text: string }) => {
        sent.push(input);

        return Promise.resolve({ providerMessageId: 'POS-RECEIPT-1' });
      }
    }));

    const { storeId, saleId, identity } = await paidSale('11988887777');

    const before = panelEvents.sendMessage.mock.calls.length;

    deepEqual((await send(identity, saleId)).body, { sent: true });
    equal(sent.length, 1);
    ok(sent[0]!.text.endsWith('Não é documento fiscal.'));

    const rows = await db.messages.findMany({
      select: { author: true, body: true },
      where: { store_id: storeId }
    });

    equal(rows.records.length, 1);
    equal(rows.records[0]!.author, MessageAuthor.Staff);
    equal(rows.records[0]!.body, sent[0]!.text);

    const order = await db.orders.findOne({ select: { conversation_id: true }, where: { id: saleId } });

    equal(order?.conversation_id, null);
    equal(panelEvents.sendMessage.mock.calls.length, before + 1);
  });

  it('answers 409 and leaves no confirmed row when WhatsApp rejects the send', async () => {
    mock.method(WhatsAppProviders, 'forStore', () => ({
      sendText: () => Promise.reject(new EvolutionRequestError('boom', 500, false))
    }));

    const { storeId, saleId, identity } = await paidSale('11977776666');

    await rejects(send(identity, saleId), (error: unknown) => error instanceof HttpConflictError);

    const rows = await db.messages.findMany({ select: { id: true }, where: { store_id: storeId } });

    equal(rows.records.length, 0);
  });

  it('refuses a sale without a customer phone', async () => {
    const { saleId, identity } = await paidSale(null);

    await rejects(
      send(identity, saleId),
      (error: unknown) => error instanceof HttpBadRequestError && error.context?.field === 'customer'
    );
  });
});
