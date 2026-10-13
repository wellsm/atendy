import type { MessageAuthor } from '../conversations/types';
import type { Cart, CartItem } from '../orders/repository';
import type { OrderStatus } from '../orders/types';
import type { PaymentMethod, RouterType, StorePolicy } from '../stores/types';

import { SOP_MAX_LENGTH } from '../stores/policy';
import { DeliveryMode } from '../stores/types';

export const HISTORY_LIMIT = 10;

export type AgentStore = {
  id: string;
  name: string;
  timezone: string;
  router: RouterType;
  llm_model: string;
  payment_methods: PaymentMethod[];
  delivery_mode: DeliveryMode;
  flat_fee_cents: number;
  policy?: StorePolicy | null;
};

export type HistoryMessage = {
  author: MessageAuthor;
  body: string;
};

/**
 * The previous order in the memory window (no draft open). Editable only while the store has not accepted it.
 */
export type LastOrder = {
  order_id: string;
  items: CartItem[];
  total_cents: number;
  status: OrderStatus;
  minutes_ago: number;
  editable: boolean;
};

/**
 * Limits the model must be able to explain. The review threshold and the closing cutoff stay internal
 * (`closing_soon` covers the latter).
 */
const MODEL_LIMITS = ['min_order_cents', 'max_item_qty', 'max_order_cents', 'max_change_cents'] as const;

/**
 * Fixed (cacheable) instructions for the full agent with tools. Customer-facing language: pt-BR.
 */
export const SYSTEM_PROMPT = [
  'Você é o atendente virtual da loja no WhatsApp. O contexto vem em JSON na mensagem do usuário: `store`, `cart` (pedido em aberto), `last_order` (pedido já enviado à loja, se houver), `closing_soon`, `recent_history` e `new_messages` (o que o cliente acabou de escrever).',
  'Responda sempre em português do Brasil, com mensagens curtas (1 a 3 frases), simpáticas e sem markdown.',
  'Regras:',
  '- Use somente produtos, opções e preços retornados pelas ferramentas. Nunca invente itens nem calcule preços: os totais vêm das ferramentas.',
  '- Para adicionar um item, use `search_menu` para obter os ids e depois `add_item`. Se faltar uma opção obrigatória (por exemplo, o sabor), pergunte antes de adicionar.',
  '- Pizza meio a meio é um único item com dois sabores no mesmo grupo de sabores.',
  '- Antes de fechar, garanta: entrega ou retirada, endereço com bairro (se for entrega) e forma de pagamento. Se for dinheiro, pergunte se precisa de troco e para quanto.',
  '- Antes de `place_order`, mostre o resumo com o total e peça confirmação. Só chame `place_order` depois que o cliente confirmar.',
  '- Se `last_order.editable` for true, as ferramentas alteram esse pedido: mostre o novo resumo e peça confirmação com `place_order`. Se não for editável e o cliente quiser mudar algo, chame `call_human`.',
  '- Se `closing_soon` for true, avise que a loja está fechando e que o pedido precisa ser finalizado logo.',
  '- Explique os limites de `store.limits` quando o cliente esbarrar neles (por exemplo, o pedido mínimo).',
  '- Chame `call_human` quando o cliente pedir um atendente, reclamar, quando parecer trote, ou quando você não conseguir resolver.',
  '- Se uma ferramenta retornar `needs_human` ou `order_locked`, a conversa já foi passada a um atendente: avise o cliente e não chame mais ferramentas.',
  '- Se uma ferramenta retornar outro erro, explique de forma simples e continue o atendimento.'
].join('\n');

/**
 * The store SOP goes after the fixed rules, which win on conflict: a store text never authorises inventing prices.
 */
export const buildSystemPrompt = (sop: string | null | undefined) => {
  const text = sop?.trim().slice(0, SOP_MAX_LENGTH);

  if (!text) {
    return SYSTEM_PROMPT;
  }

  return `${SYSTEM_PROMPT}\nRegras da loja (em caso de conflito, valem as regras acima):\n${text}`;
};

/**
 * Instructions for the cheap reply after code already executed the action chosen by Jev.
 */
export const REPLY_SYSTEM_PROMPT = [
  'Você é o atendente virtual da loja no WhatsApp. O sistema já executou o pedido do cliente; o resultado está em `action` no JSON da mensagem do usuário. Quando existir `action.result.cart`, ele é o pedido atual.',
  'Escreva a resposta ao cliente em português do Brasil, em 1 ou 2 frases curtas, sem markdown.',
  'Use somente itens e valores presentes no JSON; nunca calcule preços. Se o pedido ainda tiver itens em `missing`, pergunte o próximo que falta.',
  'Se `action.result.error` for `needs_human` ou `order_locked`, diga que um atendente vai continuar o atendimento.'
].join('\n');

export const buildTurnState = (input: {
  store: AgentStore;
  cart: Cart | undefined;
  history: HistoryMessage[];
  messages: string[];
  lastOrder?: LastOrder | null;
  closingSoon?: boolean;
  action?: { tool: string; result: unknown };
}) => {
  const { store } = input;

  const limits = Object.fromEntries(
    MODEL_LIMITS.flatMap((key) => (store.policy?.[key] != null ? [[key, store.policy[key]]] : []))
  );

  return JSON.stringify({
    store: {
      name: store.name,
      payment_methods: store.payment_methods,
      delivery:
        store.delivery_mode === DeliveryMode.Flat
          ? { mode: DeliveryMode.Flat, fee_cents: store.flat_fee_cents }
          : { mode: DeliveryMode.ByZone },
      ...(Object.keys(limits).length ? { limits } : {})
    },
    cart: input.cart ?? null,
    last_order: input.lastOrder ?? null,
    closing_soon: input.closingSoon ?? false,
    recent_history: input.history,
    new_messages: input.messages,
    ...(input.action ? { action: input.action } : {})
  });
};
