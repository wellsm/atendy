import type { AgentStore } from '../../src/agent/prompt';

import { deepEqual, doesNotMatch, equal, match, notEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRedirectPrompt,
  buildRedirectState,
  buildSystemPrompt,
  buildTurnState,
  redirectPromptFor,
  REPLY_SYSTEM_PROMPT,
  replyPromptFor,
  SYSTEM_PROMPT,
  systemPromptFor
} from '../../src/agent/prompt';
import { DeliveryMode, PaymentMethod, RouterType, StoreType } from '../../src/stores/types';

const FOOD_WORDS = /cardápio|pizza|cozinha|sabor|👨‍🍳/i;

describe('prompt by store type', () => {
  it('keeps the food prompts for food and for a store without a type', () => {
    equal(systemPromptFor(StoreType.Food), SYSTEM_PROMPT);
    equal(systemPromptFor(null), SYSTEM_PROMPT);
    equal(systemPromptFor(undefined), SYSTEM_PROMPT);
    equal(replyPromptFor(null), REPLY_SYSTEM_PROMPT);
    match(SYSTEM_PROMPT, /Pizza meio a meio/);
  });

  it('talks like a product catalog for retail, without restaurant words', () => {
    const system = systemPromptFor(StoreType.Retail);
    const reply = replyPromptFor(StoreType.Retail);

    notEqual(system, SYSTEM_PROMPT);
    doesNotMatch(system, FOOD_WORDS);
    doesNotMatch(reply, FOOD_WORDS);
    match(system, /catálogo/);
    match(system, /sugira até 3 produtos/);
    match(system, /Nunca invente características/);
  });

  it('appends the store rules after the prompt of its type', () => {
    const prompt = buildSystemPrompt('Embrulhamos para presente sem custo.', StoreType.Retail);

    equal(prompt.startsWith(systemPromptFor(StoreType.Retail)), true);
    match(prompt, /Embrulhamos para presente sem custo\.$/);
    equal(buildSystemPrompt(undefined, StoreType.Retail), systemPromptFor(StoreType.Retail));
  });

  it('sends the delivery schedule only for a store with delivery hours', () => {
    const store: AgentStore = {
      id: 's',
      name: 'Loja',
      timezone: 'America/Sao_Paulo',
      router: RouterType.Llm,
      llm_model: 'test/model',
      payment_methods: [PaymentMethod.Pix],
      delivery_mode: DeliveryMode.Flat,
      flat_fee_cents: 0
    };
    const state = (agentStore: AgentStore) =>
      (
        JSON.parse(buildTurnState({ store: agentStore, cart: undefined, history: [], messages: [] })) as {
          store: { delivery_schedule?: unknown };
        }
      ).store;

    equal(state(store).delivery_schedule, undefined);
    deepEqual(state({ ...store, delivery_schedule: { hours: 'Seg 09:00–18:00', lead_days: 2 } }).delivery_schedule, {
      hours: 'Seg 09:00–18:00',
      lead_days: 2
    });
    match(systemPromptFor(StoreType.Food), /reason `delivery_schedule`/);
  });

  it('sends the redirect link only when the store has one', () => {
    const store: AgentStore = {
      id: 's',
      name: 'Loja',
      timezone: 'America/Sao_Paulo',
      router: RouterType.Llm,
      llm_model: 'test/model',
      payment_methods: [PaymentMethod.Pix],
      delivery_mode: DeliveryMode.Flat,
      flat_fee_cents: 0
    };
    const redirect = { label: 'Agendamento', url: 'https://agenda.example.com/bella' };
    const state = (agentStore: AgentStore) =>
      (
        JSON.parse(buildTurnState({ store: agentStore, cart: undefined, history: [], messages: [] })) as {
          store: { redirect?: unknown };
        }
      ).store;

    equal(state(store).redirect, undefined);
    equal(state({ ...store, policy: { redirect: null } }).redirect, undefined);
    deepEqual(state({ ...store, policy: { redirect } }).redirect, redirect);

    for (const type of [StoreType.Food, StoreType.Retail]) {
      match(systemPromptFor(type), /`store\.redirect\.url` exatamente como está/);
    }
  });
});

describe('redirect store prompt', () => {
  it('sends the link, answers from the catalog and hands off, with the store SOP after the fixed rules', () => {
    for (const type of [StoreType.Food, StoreType.Retail]) {
      const prompt = redirectPromptFor(type);

      match(prompt, /`store\.redirect\.url` exatamente como está/);
      match(prompt, /`search_menu`/);
      match(prompt, /`call_human`/);
      match(prompt, /`store\.hours`/);
      doesNotMatch(prompt, /add_item|place_order/);
    }

    equal(buildRedirectPrompt(null, StoreType.Food), redirectPromptFor(StoreType.Food));
    match(buildRedirectPrompt('Corte leva 40 min.', StoreType.Food), /Regras da loja[^\n]*\nCorte leva 40 min\.$/);
  });

  it('gives the model the link, the service hours and the conversation', () => {
    const state: unknown = JSON.parse(
      buildRedirectState({
        storeName: 'Bella Studio',
        redirect: { label: 'Agendamento', url: 'https://agenda.example.com/bella' },
        hours: 'Seg 09:00–18:00',
        openNow: false,
        history: [{ author: 'bot' as never, body: 'Olá!' }],
        messages: ['quanto custa o corte?']
      })
    );

    deepEqual(state, {
      store: {
        name: 'Bella Studio',
        redirect: { label: 'Agendamento', url: 'https://agenda.example.com/bella' },
        hours: 'Seg 09:00–18:00',
        open_now: false
      },
      recent_history: [{ author: 'bot', body: 'Olá!' }],
      new_messages: ['quanto custa o corte?']
    });
  });
});
