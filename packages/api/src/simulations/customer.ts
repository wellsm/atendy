import type { Scenario } from './types';
import type { ChatMessage, ReasoningEffort } from '../agent/openrouter-client';

import { OpenRouterClient } from '../agent/openrouter-client';

/**
 * Models that may play the customer, chosen per run. Reasoning only costs (billed as output) and slows the turn:
 * the OpenAI ones run with low effort; Haiku does not reason unless asked.
 */
export const SIMULATION_CUSTOMER_MODELS: { id: string; reasoningEffort?: ReasoningEffort }[] = [
  { id: 'openai/gpt-6-luna', reasoningEffort: 'low' },
  { id: 'openai/gpt-5.6-luna', reasoningEffort: 'low' },
  { id: 'anthropic/claude-haiku-5.5' },
  { id: 'openai/gpt-4.1-mini' }
];

export const DEFAULT_SIMULATION_CUSTOMER_MODEL = SIMULATION_CUSTOMER_MODELS[0]!.id;

export const isSimulationCustomerModel = (model: string) => SIMULATION_CUSTOMER_MODELS.some(({ id }) => id === model);

export type CustomerTurn = {
  messages: string[];
  /**
   * The goal was reached (or abandoned on purpose): no more messages.
   */
  done: boolean;
  /**
   * Send the WhatsApp location pin (`facts.location`) after the messages.
   */
  location: boolean;
};

export type TranscriptMessage = {
  /**
   * True for the customer's own messages.
   */
  fromCustomer: boolean;
  body: string;
};

export const buildCustomerPrompt = (scenario: Scenario) =>
  [
    'Você é um cliente conversando pelo WhatsApp com o atendente virtual de uma loja de comida.',
    'Escreva como um cliente brasileiro real: mensagens curtas, linguagem do dia a dia, uma ideia por mensagem.',
    scenario.persona ? `Seu jeito: ${scenario.persona}.` : '',
    `Seu objetivo: ${scenario.goal ?? ''}.`,
    `Seus dados (use só quando o atendente pedir; nunca invente outros): ${JSON.stringify(scenario.facts)}.`,
    scenario.facts.location
      ? 'Quando pedirem o endereço e você preferir mandar a localização, use "location": true em vez de digitar. Mande a localização uma vez só; se depois pedirem o endereço escrito, digite o de seus dados.'
      : '',
    'Responda só o que foi perguntado e siga o objetivo; se o atendente oferecer algo fora do objetivo, recuse.',
    'Se o atendente mostrar o resumo e pedir confirmação, responda confirmando (ou corrigindo o que estiver errado); o resumo sozinho não conclui o pedido.',
    'Se o objetivo for desistir, primeiro diga ao atendente que desistiu e por quê; só depois encerre.',
    'Quando o objetivo estiver cumprido (o atendente disse que o pedido foi enviado/registrado, informação recebida ou desistência já dita), use "done": true e não mande mais mensagens.',
    'Responda SOMENTE com JSON: {"messages": ["..."], "done": false, "location": false}.'
  ]
    .filter(Boolean)
    .join('\n');

/**
 * The customer model sees its own messages as `assistant` and the store's as `user`.
 */
export const customerChat = (scenario: Scenario, transcript: TranscriptMessage[]): ChatMessage[] => [
  { role: 'system', content: buildCustomerPrompt(scenario) },
  ...transcript.map(({ fromCustomer, body }): ChatMessage =>
    fromCustomer ? { role: 'assistant', content: body } : { role: 'user', content: body }
  ),
  ...(transcript.length ? [] : [{ role: 'user' as const, content: '(o cliente começa a conversa)' }])
];

/**
 * Reads the model answer; plain text (no JSON) becomes one message.
 */
export const parseCustomerTurn = (content: string | null): CustomerTurn => {
  const text = (content ?? '').trim();
  const json = /\{[\s\S]*\}/u.exec(text)?.[0];

  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<Record<keyof CustomerTurn, unknown>>;
      const messages = Array.isArray(parsed.messages)
        ? parsed.messages.filter((message): message is string => typeof message === 'string' && !!message.trim())
        : [];

      return { messages, done: parsed.done === true, location: parsed.location === true };
    } catch {
      // Not JSON after all: treated as text below.
    }
  }

  return { messages: text ? [text] : [], done: false, location: false };
};

export namespace SimulatedCustomer {
  export const next = async (input: {
    apiKey: string;
    model: string;
    scenario: Scenario;
    transcript: TranscriptMessage[];
  }) => {
    const config = SIMULATION_CUSTOMER_MODELS.find(({ id }) => id === input.model);

    const { message, usage } = await OpenRouterClient.chat({
      apiKey: input.apiKey,
      model: input.model,
      messages: customerChat(input.scenario, input.transcript),
      ...(config?.reasoningEffort && { reasoningEffort: config.reasoningEffort })
    });

    return { turn: parseCustomerTurn(message.content), costUsd: usage.costUsd };
  };
}
