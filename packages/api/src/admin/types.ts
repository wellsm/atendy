import type { AiPath, AiProvider } from '../agent/types';
import type { ConversationMode, MessageAuthor } from '../conversations/types';
import type { BillingSummary } from '../payments/types';
import type { RouterType } from '../stores/types';
import type { OrderCodeMode } from '../stores/types';

export type AdminIdentity = {
  userId: string;
};

export type AdminStore = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  acceptingOrders: boolean;
  createdAt: string;
  router: RouterType;
  llmModel: string;
};

export type AdminStoreRow = AdminStore & {
  lastMessageAt: string | null;
  errorCount24h: number;
};

export type AdminStoreHealth = {
  lastMessageAt: string | null;
  errorCount24h: number;
  recentErrors: {
    conversationId: string;
    reason: string;
    at: string;
  }[];
  activeProducts: number;
  openNow: boolean;
  acceptingOrders: boolean;
};

export type AdminStoreDetail = {
  store: AdminStore;
  health: AdminStoreHealth;
  /**
   * `null` = default (3 h).
   */
  orderMemoryHours: number | null;
  /**
   * Price of an order the AI took all the way; `null` = `defaultOrderPriceCents`.
   */
  orderPriceCents: number | null;
  defaultOrderPriceCents: number;
  /**
   * Percent of the price billed for a web order; `null` = `defaultWebOrderPercent`.
   */
  webOrderPercent: number | null;
  defaultWebOrderPercent: number;
  orderCodeMode: OrderCodeMode;
  models: string[];
  billing: BillingSummary | null;
};

export const toAdminStore = (store: {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  accepting_orders: boolean;
  created_at: string;
  router: RouterType;
  llm_model: string;
}): AdminStore => ({
  id: store.id,
  name: store.name,
  slug: store.slug,
  active: store.active,
  acceptingOrders: store.accepting_orders,
  createdAt: store.created_at,
  router: store.router,
  llmModel: store.llm_model
});

export type AdminConversation = {
  id: string;
  storeId: string;
  storeName: string;
  customerPhone: string;
  mode: ConversationMode;
  handoffReason: string | null;
  lastMessageAt: string;
};

export type AdminConversationRow = AdminConversation & {
  /**
   * Last message, first 80 characters.
   */
  preview: string;
};

export type AdminMessage = {
  id: string;
  incoming: boolean;
  author: MessageAuthor;
  body: string;
  at: string;
};

export type AdminAiCall = {
  id: string;
  provider: AiProvider;
  model: string;
  path: AiPath;
  intent: string | null;
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  /**
   * Null on calls logged before prompt versions existed.
   */
  promptVersion: string | null;
  tools: AdminToolTrace[] | null;
  at: string;
};

/**
 * A tool run as the admin sees it. `args` is the JSON the model sent, as text: the gateway re-cases object keys on the
 * way out, and the inspector must show them exactly as sent.
 */
export type AdminToolTrace = {
  name: string;
  args: string | null;
  ok: boolean;
  error?: string;
};
