import type { ChatMessage } from '../../src/agent/openrouter-client';
import type { ToolContext } from '../../src/agent/tools';
import type { Db } from '../../src/db';

import { equal, ok } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { executeTool } from '../../src/agent/tools';
import { TurnResponder } from '../../src/agent/turn';
import { OrderRepository } from '../../src/orders/repository';
import { locateWithGoogle } from '../../src/stores/geocoding';
import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode, PaymentMethod, RouterType } from '../../src/stores/types';
import { formatLocationBody } from '../../src/whatsapp/location';
import { seedConversation, seedMenu, seedStore } from '../support/fixtures';

const STORE = { latitude: -23.55052, longitude: -46.633308 };

describe('distance delivery in the agent turn', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const setup = async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const conversation = await seedConversation(db, storeId);

    await StoreRepository.setStoreLocation(db, storeId, { address: 'Praça da Sé', ...STORE });
    await StoreRepository.replaceDelivery(db, storeId, {
      mode: DeliveryMode.ByDistance,
      flatFeeCents: 0,
      zones: [],
      bands: [{ maxMeters: 5000, feeCents: 900 }]
    });

    const store = {
      id: storeId,
      name: 'Pizzaria Teste',
      timezone: 'America/Sao_Paulo',
      router: RouterType.Llm,
      llm_model: 'test/model',
      payment_methods: [PaymentMethod.Pix],
      delivery_mode: DeliveryMode.ByDistance,
      flat_fee_cents: 0
    };

    return { storeId, store, menu, ...conversation };
  };

  it('stores a shared location before the model runs and shows the fee in the turn state', async () => {
    const { store, conversationId, customerId, messageId } = await setup();

    const chat = mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve({
        message: { role: 'assistant' as const, content: 'Entrega fica R$ 9,00.' },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        latencyMs: 1
      })
    );

    await TurnResponder.respond({
      db,
      env: { OPENROUTER_API_KEY: 'o', GOOGLE_MAPS_API_KEY: 'g' },
      store,
      hours: [],
      conversationId,
      customerId,
      messages: [{ id: messageId, body: formatLocationBody({ latitude: -23.561414, longitude: -46.655881 }) }]
    });

    const cart = await OrderRepository.getCart(db, (await OrderRepository.findDraftId(db, conversationId))!);

    equal(cart.fee_cents, 900);

    const state = (chat.mock.calls[0]!.arguments[0] as { messages: ChatMessage[] }).messages[1]!.content as string;

    ok(state.includes('"distance_km"'), state);
    ok(state.includes('Localização enviada'), state);
    ok(!state.includes('-46.655881'), 'coordinates must not reach the model');
  });

  it('turns an address Google cannot place into location_needed', async () => {
    const { storeId, menu, conversationId, customerId } = await setup();

    const ctx: ToolContext = {
      db,
      storeId,
      conversationId,
      customerId,
      menu,
      mutated: false,
      geocode: () => Promise.resolve(undefined)
    };

    const result = await executeTool(ctx, 'set_address', { address: 'Rua Sem Nome', neighborhood: 'Centro' });

    equal(result.ok, false);
    equal(!result.ok && result.error, 'location_needed');
  });

  it('treats a Google failure as an unplaced address', async () => {
    mock.method(globalThis, 'fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ status: 'OVER_QUERY_LIMIT', results: [] }), { status: 200 }))
    );

    equal(await locateWithGoogle('key')('Rua X', STORE), undefined);
    equal(await locateWithGoogle(undefined)('Rua X', STORE), undefined);
  });
});
