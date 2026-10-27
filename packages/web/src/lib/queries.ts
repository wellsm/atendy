import type { CostReport } from './costs';
import type { LossReason, StockFilter, StockUnit } from './stock';

import { useAuth, useOrganizationList } from '@clerk/react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { ApiError, useApi } from './api';

export type PanelStore = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  accepting_orders: boolean;
  /**
   * The hours say open right now. Independent of `accepting_orders`.
   */
  open_now: boolean;
};

export type Me = {
  has_org: boolean;
  store: PanelStore | null;
};

export type RouterType = 'jev' | 'llm';

export type DemoMenuKind = 'pizzeria' | 'burger' | 'snack_bar' | 'pasta' | 'pastry' | 'acai' | 'lunchbox' | 'japanese';

export type AdminStore = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  accepting_orders: boolean;
  created_at: string;
  router: RouterType;
  llm_model: string;
};

export type AdminStoreRow = AdminStore & {
  last_message_at: string | null;
  error_count_24h: number;
};

export type AdminStoreDetail = {
  store: AdminStore;
  health: {
    last_message_at: string | null;
    error_count_24h: number;
    recent_errors: { conversation_id: string; reason: string; at: string }[];
    active_products: number;
    open_now: boolean;
    accepting_orders: boolean;
  };
  order_memory_hours: number | null;
  /**
   * Price of an order the AI took all the way; null = `default_order_price_cents`.
   */
  order_price_cents: number | null;
  default_order_price_cents: number;
  /**
   * Percent of the price billed for an order placed on the public menu; null = `default_web_order_percent`.
   */
  web_order_percent: number | null;
  default_web_order_percent: number;
  order_code_mode: 'random' | 'sequential';
  models: string[];
  billing: BillingSummary | null;
};

/**
 * Keyed by org: switching org must never show the previous store.
 */
export const useMe = () => {
  const api = useApi();
  const { orgId } = useAuth();

  return useQuery({
    queryKey: ['me', orgId ?? null],
    queryFn: () => api<Me>('GET', '/panel/me'),
    // `open_now` follows the clock.
    refetchInterval: 60_000
  });
};

/**
 * Mirrors the store in Clerk: without an active org, creates one with the store name and activates it, so the
 * token carries the org the API links the store to.
 */
export const useCreateStore = (options: { newOrg?: boolean } = {}) => {
  const api = useApi();
  const { orgId } = useAuth();
  const { createOrganization, setActive } = useOrganizationList();
  const queryClient = useQueryClient();
  // An org created by a failed attempt is reused on retry, so a failing API never leaves a trail of empty orgs.
  const createdOrgId = useRef<string | undefined>(undefined);

  return useMutation({
    mutationFn: async (input: { name: string }) => {
      // "+ Nova loja": always a new org, even when the session already has one.
      if (!orgId || options.newOrg) {
        if (!createOrganization || !setActive) {
          throw new Error('Clerk is not loaded');
        }

        createdOrgId.current ??= (await createOrganization({ name: input.name })).id;

        await setActive({ organization: createdOrgId.current });
      }

      return api<{ store: PanelStore }>('POST', '/panel/stores', { name: input.name, accept_risk: true });
    },
    // The active org changed when a new one was created: drop every cached store.
    onSuccess: () => (options.newOrg ? queryClient.clear() : queryClient.invalidateQueries({ queryKey: ['me'] }))
  });
};

export type StoreLink = {
  org_id: string;
  slug: string;
  name: string;
};

/**
 * Slug of each store the user belongs to (one Clerk org each): the panel routes by slug.
 */
export const useMyStores = () => {
  const api = useApi();
  const { userMemberships } = useOrganizationList({ userMemberships: { pageSize: 50 } });
  const orgIds = (userMemberships.data ?? []).map(({ organization }) => organization.id);

  return useQuery({
    queryKey: ['stores', orgIds],
    queryFn: async () => {
      const query = new URLSearchParams({ org_ids: orgIds.join(',') });

      return (await api<{ stores: StoreLink[] }>('GET', `/panel/stores?${query}`)).stores;
    },
    enabled: !!userMemberships.data
  });
};

export const useAdminStores = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'stores'],
    queryFn: () => api<{ stores: AdminStoreRow[] }>('GET', '/admin/stores')
  });
};

export const useSetStoreActive = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { storeId: string; active: boolean }) =>
      api<AdminStoreDetail>('PATCH', `/admin/stores/${input.storeId}`, { active: input.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
  });
};

export type OrderStatus = 'placed' | 'accepted' | 'out' | 'done' | 'canceled' | 'abandoned';

export type PanelOrder = {
  id: string;
  /**
   * `K7Q2MX` / `128`, shown as `#K7Q2MX`.
   */
  code: string;
  status: OrderStatus;
  fulfillment: 'delivery' | 'pickup' | null;
  address: string | null;
  neighborhood: string | null;
  payment_method: 'pix' | 'card' | 'cash' | null;
  change_for_cents: number | null;
  subtotal_cents: number;
  fee_cents: number;
  total_cents: number;
  placed_at: string | null;
  /**
   * Abandoned drafts: when the customer stopped.
   */
  abandoned_at: string | null;
  amended_at: string | null;
  /**
   * `web`: the customer ordered on the public menu.
   */
  source: 'web' | null;
  conversation_id: string;
  customer: { name: string | null; phone: string };
  items: { id: string; name: string; qty: number; options: string; notes: string | null; unit_price_cents: number }[];
};

export type OrderScope = 'open' | 'closed';

/**
 * A placed or abandoned order of a conversation, shown between its messages at `at`.
 */
export type OrderMark = { id: string; code: string | null; status: OrderStatus; at: string; total_cents: number };

export const useOrders = (scope: OrderScope) => {
  const api = useApi();

  return useQuery({
    queryKey: ['orders', scope],
    queryFn: () => api<{ orders: PanelOrder[] }>('GET', `/panel/orders?scope=${scope}`),
    refetchInterval: scope === 'open' ? 5_000 : 30_000
  });
};

export const useUpdateOrder = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { orderId: string; status: OrderStatus }) =>
      api<{ order: PanelOrder; notified: boolean }>('PATCH', `/panel/orders/${input.orderId}`, {
        status: input.status
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders'] })
  });
};

export type PanelConversation = {
  id: string;
  mode: 'bot' | 'human';
  handoff_reason: string | null;
  /**
   * The bot paused and waits for the store to approve this (a limit or a suspected prank).
   */
  approval_reason: string | null;
  last_message_at: string;
  customer: { name: string | null; phone: string };
  /**
   * Only in the conversation list: the start of the newest message.
   */
  last_message?: { author: PanelMessage['author']; body: string } | null;
};

export type PanelMessage = {
  id: string;
  author: 'customer' | 'bot' | 'staff';
  body: string;
  created_at: string;
  /**
   * The customer's reaction to this message (emoji).
   */
  reaction: string | null;
  /**
   * Signed URL (1 h) of the saved voice note.
   */
  audio_url: string | null;
};

export const useConversations = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<{ conversations: PanelConversation[] }>('GET', '/panel/conversations'),
    refetchInterval: 10_000
  });
};

export const useConversation = (conversationId: string | undefined) => {
  const api = useApi();

  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () =>
      api<{
        conversation: PanelConversation;
        messages: PanelMessage[];
        orders: OrderMark[];
        /**
         * Steps the current draft reached; null without a draft.
         */
        progress: OrderStep[] | null;
      }>('GET', `/panel/conversations/${conversationId}`),
    enabled: !!conversationId,
    refetchInterval: 5_000
  });
};

const useInvalidateConversation = () => {
  const queryClient = useQueryClient();

  return (conversationId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] }),
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    ]);
};

export const useSetConversationMode = () => {
  const api = useApi();
  const invalidate = useInvalidateConversation();

  return useMutation({
    mutationFn: (input: { conversationId: string; mode: PanelConversation['mode'] }) =>
      api<{ conversation: PanelConversation }>('PATCH', `/panel/conversations/${input.conversationId}`, {
        mode: input.mode
      }),
    onSettled: (_data, _error, input) => invalidate(input.conversationId)
  });
};

export type DraftCart = {
  order_id: string;
  items: {
    item_id: string;
    name: string;
    qty: number;
    options: string;
    unit_price_cents: number;
    line_total_cents: number;
    notes: string | null;
  }[];
  fulfillment: 'delivery' | 'pickup' | null;
  address: string | null;
  neighborhood: string | null;
  payment_method: PaymentMethod | null;
  change_for_cents: number | null;
  subtotal_cents: number;
  fee_cents: number;
  total_cents: number;
  distance_km: number | null;
  missing: string[];
};

export type DraftUpdate =
  | { fulfillment: 'delivery' | 'pickup' }
  | { address: { address: string; neighborhood: string | null } }
  | { use_saved_address: true }
  | { payment: { method: PaymentMethod; change_for_cents: number | null } };

/**
 * The draft the attendant builds in a conversation they took over (the bot's half-built one included).
 */
export const useDraft = (conversationId: string, enabled: boolean) => {
  const api = useApi();

  return useQuery({
    queryKey: ['draft', conversationId],
    queryFn: () =>
      api<{ cart: DraftCart | null; saved_address: { address: string; neighborhood: string | null } | null }>(
        'GET',
        `/panel/conversations/${conversationId}/draft`
      ),
    enabled
  });
};

/**
 * Every draft write answers with the cart: it replaces the cached one, so the editor never waits for a refetch.
 */
const useDraftMutation = <Input>(
  conversationId: string,
  request: (input: Input) => [method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown]
) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Input) => {
      const [method, path, body] = request(input);

      return api<{ cart: DraftCart }>(method, `/panel/conversations/${conversationId}/draft${path}`, body);
    },
    onSuccess: ({ cart }) =>
      queryClient.setQueryData(['draft', conversationId], (previous: { saved_address: unknown } | undefined) => ({
        saved_address: previous?.saved_address ?? null,
        cart
      }))
  });
};

export const useAddDraftItem = (conversationId: string) =>
  useDraftMutation(
    conversationId,
    (input: {
      product_id: string;
      qty: number;
      selections: { group_id: string; option_ids: string[] }[];
      notes: string | null;
    }) => ['POST', '/items', input]
  );

export const useRemoveDraftItem = (conversationId: string) =>
  useDraftMutation(conversationId, (itemId: string) => ['DELETE', `/items/${itemId}`]);

export const useUpdateDraft = (conversationId: string) =>
  useDraftMutation(conversationId, (input: DraftUpdate) => ['PATCH', '', input]);

/**
 * "Fechar pedido": the draft becomes an open order (the open orders list shows it).
 */
export const usePlaceDraft = (conversationId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api<{ cart: DraftCart }>('POST', `/panel/conversations/${conversationId}/draft/place`),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['draft', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] })
      ])
  });
};

/**
 * "Aprovar e continuar": the bot answers the messages that waited, without the limit it hit.
 */
export const useApproveConversation = () => {
  const api = useApi();
  const invalidate = useInvalidateConversation();

  return useMutation({
    mutationFn: (conversationId: string) =>
      api<{ conversation: PanelConversation }>('POST', `/panel/conversations/${conversationId}/approval`),
    onSettled: (_data, _error, conversationId) => invalidate(conversationId)
  });
};

export const useSendMessage = () => {
  const api = useApi();
  const invalidate = useInvalidateConversation();

  return useMutation({
    mutationFn: (input: { conversationId: string; text: string }) =>
      api<{ conversation: PanelConversation }>('POST', `/panel/conversations/${input.conversationId}/messages`, {
        text: input.text
      }),
    onSettled: (_data, _error, input) => invalidate(input.conversationId)
  });
};

export const useUpdateStore = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name?: string; accepting_orders?: boolean }) =>
      api<{ store: PanelStore }>('PATCH', '/panel/store', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['me'] })
  });
};

export type PaymentMethod = 'pix' | 'card' | 'cash';

export type DeliveryMode = 'flat' | 'by_zone' | 'by_distance';

export type HourRange = {
  /**
   * 0 = Sunday … 6 = Saturday.
   */
  weekday: number;
  opens_at: string;
  closes_at: string;
};

export type DeliveryZone = { neighborhood: string; fee_cents: number };

export type DeliveryBand = { max_meters: number; fee_cents: number };

export type DeliverySettings = {
  mode: DeliveryMode;
  flat_fee_cents: number;
  zones: DeliveryZone[];
  /**
   * `by_distance` only.
   */
  bands?: DeliveryBand[];
};

/**
 * Store address as Google formatted it, origin of distance delivery.
 */
export type StoreLocation = { address: string; latitude: number; longitude: number };

export type PolicySettings = {
  min_order_cents: number | null;
  max_order_cents: number | null;
  max_change_cents: number | null;
  max_item_qty: number | null;
  new_customer_review_cents: number | null;
  last_order_minutes: number | null;
  delivery_min_minutes: number | null;
  delivery_max_minutes: number | null;
  sop: string | null;
  /**
   * Null = `ask`.
   */
  previous_address: PreviousAddress | null;
  /**
   * Empty or null: the bot never offers to repeat the previous order.
   */
  repeat_order_statuses: OrderStatus[] | null;
  /**
   * The customer may start another order once the last one reached this status. Null = `done`.
   */
  new_order_after_status: NewOrderAfterStatus | null;
  /**
   * Categories the customer may add to an order being prepared. Null = the drink categories; empty = none.
   */
  add_on_category_ids: string[] | null;
  add_on_extra_minutes: number | null;
};

export type NewOrderAfterStatus = 'accepted' | 'out' | 'done';

export type PreviousAddress = 'ask' | 'on_request';

export type Settings = {
  hours: HourRange[];
  delivery: DeliverySettings;
  payment_methods: PaymentMethod[];
  policy: PolicySettings;
  store_location: StoreLocation | null;
  /**
   * WhatsApp that gets the daily low-stock summary; null = no summary.
   */
  stock_alert_phone: string | null;
  /**
   * Hour (0-23, store time) the summary goes out; null = the default.
   */
  stock_alert_hour: number | null;
};

export const useSettings = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('GET', '/panel/settings')
  });
};

const useSettingsMutation = <TInput, TOutput>(method: 'POST' | 'PUT' | 'PATCH', path: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => api<TOutput>(method, path, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] })
  });
};

export const useUpdateHours = () =>
  useSettingsMutation<{ hours: HourRange[] }, { hours: HourRange[] }>('PUT', '/panel/settings/hours');

export const useUpdateDelivery = () =>
  useSettingsMutation<DeliverySettings, { delivery: DeliverySettings }>('PUT', '/panel/settings/delivery');

export const useLocateStore = () =>
  useSettingsMutation<{ address: string }, { store_location: StoreLocation }>('POST', '/panel/settings/store-location');

export const useUpdatePayment = () =>
  useSettingsMutation<{ payment_methods: PaymentMethod[] }, { payment_methods: PaymentMethod[] }>(
    'PUT',
    '/panel/settings/payment'
  );

export const useUpdateStockAlert = () =>
  useSettingsMutation<
    { stock_alert_phone: string | null; stock_alert_hour: number | null },
    { stock_alert_phone: string | null; stock_alert_hour: number | null }
  >('PUT', '/panel/settings/stock-alert');

export const useUpdatePolicy = () =>
  useSettingsMutation<Partial<PolicySettings>, { policy: PolicySettings }>('PATCH', '/panel/settings/policy');

export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'in_review';

export type BillingInvoice = {
  id: string;
  period_start: string;
  period_end: string;
  orders: number;
  amount_cents: number;
  due_date: string;
  status: InvoiceStatus;
  failure_reason: string | null;
  invoice_url: string | null;
  paid_at: string | null;
};

export type BillingSummary = {
  card: { brand: string; last4: string } | null;
  blocked: boolean;
  price_cents: number;
  open: { orders: number; amount_cents: number };
  invoices: BillingInvoice[];
};

/**
 * Sent straight to Asaas through the API; never kept in the browser beyond the form.
 */
export type BillingCardInput = {
  holder: {
    name: string;
    cpf_cnpj: string;
    email: string;
    phone: string;
    postal_code: string;
    address_number: string;
  };
  card: { holder_name: string; number: string; expiry_month: string; expiry_year: string; ccv: string };
};

export const useBilling = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['billing'],
    queryFn: () => api<BillingSummary>('GET', '/panel/billing')
  });
};

export const useUpdateBillingCard = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BillingCardInput) => api<BillingSummary>('POST', '/panel/billing/card', input),
    onSuccess: (summary) => queryClient.setQueryData(['billing'], summary)
  });
};

export type WhatsAppState = 'not_created' | 'connecting' | 'connected' | 'disconnected';

export const useWhatsAppState = (poll: boolean) => {
  const api = useApi();

  return useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => api<{ state: WhatsAppState }>('GET', '/panel/whatsapp'),
    refetchInterval: poll ? 3_000 : false
  });
};

export const useConnectWhatsApp = () => {
  const api = useApi();

  return useMutation({
    mutationFn: () => api<{ qr_base64: string | null; pairing_code: string | null }>('POST', '/panel/whatsapp/connect')
  });
};

export const useDisconnectWhatsApp = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api<{ state: WhatsAppState }>('POST', '/panel/whatsapp/disconnect'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['whatsapp'] })
  });
};

export type PriceMode = 'sum' | 'max';

export type MenuOption = {
  id: string;
  name: string;
  price_delta_cents: number;
  active: boolean;
  /**
   * Linked stock ran out. Not the same as inactive: the store did not turn it off.
   */
  sold_out: boolean;
  /**
   * Signed URL, valid for about an hour; null without a photo.
   */
  image_url: string | null;
};

export type MenuGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  price_mode: PriceMode;
  options: MenuOption[];
};

export type MenuProduct = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  sold_out: boolean;
  /**
   * Signed URL, valid for about an hour; null without a photo.
   */
  image_url: string | null;
  groups: MenuGroup[];
};

export type MenuCategory = {
  id: string;
  name: string;
  products: MenuProduct[];
};

/**
 * A product saved whole. Groups and options without `id` are new; with `id` they keep it (a group of another product
 * becomes shared: its name, price mode and options change for both). `active` goes only when the form changed it, so a
 * sold-out toggle made meanwhile survives the save.
 */
export type ProductInput = Omit<MenuProduct, 'id' | 'active' | 'sold_out' | 'image_url' | 'groups'> & {
  active?: boolean;
  groups: (Omit<MenuGroup, 'id' | 'options'> & {
    id?: string;
    options: (Omit<MenuOption, 'id' | 'active' | 'sold_out' | 'image_url'> & { id?: string; active?: boolean })[];
  })[];
};

export const useMenu = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['menu'],
    queryFn: () => api<{ categories: MenuCategory[] }>('GET', '/panel/menu')
  });
};

const useMenuMutation = <TInput, TOutput>(
  request: (api: ReturnType<typeof useApi>, input: TInput) => Promise<TOutput>
) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => request(api, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['menu'] })
  });
};

export const useCreateCategory = () =>
  useMenuMutation((api, input: { name: string }) =>
    api<{ category: { id: string; name: string } }>('POST', '/panel/menu/categories', input)
  );

export const useRenameCategory = () =>
  useMenuMutation((api, { id, name }: { id: string; name: string }) =>
    api<{ category: { id: string; name: string } }>('PATCH', `/panel/menu/categories/${id}`, { name })
  );

export const useReorderCategories = () =>
  useMenuMutation((api, input: { ids: string[] }) =>
    api<{ categories: { id: string; name: string }[] }>('PUT', '/panel/menu/categories/order', input)
  );

export const useDeleteCategory = () =>
  useMenuMutation((api, id: string) => api<{ id: string }>('DELETE', `/panel/menu/categories/${id}`));

export const useCreateProduct = () =>
  useMenuMutation((api, input: ProductInput) => api<{ product: MenuProduct }>('POST', '/panel/menu/products', input));

export const useUpdateProduct = () =>
  useMenuMutation((api, { id, input }: { id: string; input: ProductInput }) =>
    api<{ product: MenuProduct }>('PUT', `/panel/menu/products/${id}`, input)
  );

/**
 * Product ids by outcome: linked, skipped for already having the group (or one with that name), skipped at the group
 * limit.
 */
export type ApplyGroupResult = { applied: string[]; already_had: string[]; full: string[] };

export const useApplyGroup = () =>
  useMenuMutation(
    (api, { groupId, productIds, min, max }: { groupId: string; productIds: string[]; min: number; max: number }) =>
      api<ApplyGroupResult>('POST', `/panel/menu/groups/${groupId}/apply`, { product_ids: productIds, min, max })
  );

/**
 * A group's shared part, edited from the groups library (limits stay per product).
 */
export type GroupContentInput = Omit<ProductInput['groups'][number], 'id' | 'min' | 'max'>;

export const useUpdateGroup = () =>
  useMenuMutation((api, { id, input }: { id: string; input: GroupContentInput }) =>
    api<{ group: MenuGroup }>('PUT', `/panel/menu/groups/${id}`, input)
  );

export const useDeleteGroup = () =>
  useMenuMutation((api, id: string) => api<{ id: string }>('DELETE', `/panel/menu/groups/${id}`));

/**
 * Photo change saved after the product itself: a resized upload, or removing the current one.
 */
export type ImageChange = { kind: 'upload'; blob: Blob } | { kind: 'remove' };

/**
 * Photos changed in the product form. Options are addressed by position because new ones only get an id when the
 * product is saved (the response keeps the form's order).
 */
export type PendingImages = {
  product?: ImageChange;
  options: { group: number; option: number; change: ImageChange }[];
};

export const hasPendingImages = (images: PendingImages) => !!images.product || images.options.length > 0;

/**
 * Upload goes browser → bucket with a signed PUT, then the API checks and publishes it.
 */
const saveImage = async (
  api: ReturnType<typeof useApi>,
  target: 'products' | 'options',
  id: string,
  change: ImageChange
) => {
  const path = `/panel/menu/${target}/${id}/image`;

  if (change.kind === 'remove') {
    return api<{ image_url: null }>('DELETE', path);
  }

  const { upload_url } = await api<{ upload_url: string }>('POST', `${path}/upload`, {
    content_type: change.blob.type
  });

  const uploaded = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'content-type': change.blob.type },
    body: change.blob
  });

  if (!uploaded.ok) {
    throw new ApiError(uploaded.status, undefined, 'image');
  }

  return api<{ image_url: string | null }>('POST', path);
};

/**
 * Saves the photos after the product itself (one request chain per photo, in order).
 */
export const useSaveMenuImages = () =>
  useMenuMutation(async (api, { product, images }: { product: MenuProduct; images: PendingImages }) => {
    if (images.product) {
      await saveImage(api, 'products', product.id, images.product);
    }

    for (const { group, option, change } of images.options) {
      const id = product.groups[group]?.options[option]?.id;

      if (id) {
        await saveImage(api, 'options', id, change);
      }
    }
  });

/**
 * Option photos changed in the groups library, saved after the group (options addressed by position, as above).
 */
export const useSaveGroupImages = () =>
  useMenuMutation(async (api, { group, images }: { group: MenuGroup; images: PendingImages['options'] }) => {
    for (const { option, change } of images) {
      const id = group.options[option]?.id;

      if (id) {
        await saveImage(api, 'options', id, change);
      }
    }
  });

export const useDeleteProduct = () =>
  useMenuMutation((api, id: string) => api<{ id: string }>('DELETE', `/panel/menu/products/${id}`));

export const useSetProductActive = () =>
  useMenuMutation((api, { id, active }: { id: string; active: boolean }) =>
    api<{ product: MenuProduct }>('PATCH', `/panel/menu/products/${id}/active`, { active })
  );

export const useSetOptionActive = () =>
  useMenuMutation((api, { id, active }: { id: string; active: boolean }) =>
    api<{ option: { id: string; active: boolean } }>('PATCH', `/panel/menu/options/${id}/active`, { active })
  );

export const useAdminStore = (storeId: string) => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'stores', storeId],
    queryFn: () => api<AdminStoreDetail>('GET', `/admin/stores/${storeId}`)
  });
};

export const useUpdateAdminStore = (storeId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      active?: boolean;
      router?: RouterType;
      llm_model?: string;
      order_memory_hours?: number | null;
      order_price_cents?: number | null;
      web_order_percent?: number | null;
      order_code_mode?: 'random' | 'sequential';
    }) => api<AdminStoreDetail>('PATCH', `/admin/stores/${storeId}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
  });
};

export const useSeedDemoMenu = (storeId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { kind: DemoMenuKind; replace?: boolean }) =>
      api<{ products: number }>('POST', `/admin/stores/${storeId}/demo-menu`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
  });
};

/**
 * Billing job for one store, optionally as if it were `now` (ISO instant) to test a cycle close.
 */
export const useRunAdminBilling = (storeId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { now?: string }) =>
      api<{ ok: boolean }>('POST', '/admin/billing/run', { ...input, store_id: storeId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores', storeId] })
  });
};

/**
 * Test: the store's pending invoice is charged today instead of on the charge day.
 */
export const useChargeAdminBillingNow = (storeId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api<{ ok: boolean }>('POST', `/admin/stores/${storeId}/billing/charge-now`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores', storeId] })
  });
};

/**
 * WhatsApp hooks of one store for the admin, same shape as the store's own (`WhatsAppHooks`).
 */
export const adminWhatsAppHooks = (storeId: string) => ({
  useState: (poll: boolean) => {
    const api = useApi();

    return useQuery({
      queryKey: ['admin', 'stores', storeId, 'whatsapp'],
      queryFn: () => api<{ state: WhatsAppState }>('GET', `/admin/stores/${storeId}/whatsapp`),
      refetchInterval: poll ? 3_000 : false
    });
  },
  useConnect: () => {
    const api = useApi();

    return useMutation({
      mutationFn: () =>
        api<{ qr_base64: string | null; pairing_code: string | null }>(
          'POST',
          `/admin/stores/${storeId}/whatsapp/connect`
        )
    });
  },
  useDisconnect: () => {
    const api = useApi();
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: () => api<{ state: WhatsAppState }>('POST', `/admin/stores/${storeId}/whatsapp/disconnect`),
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores', storeId, 'whatsapp'] })
    });
  }
});

export const useCostReport = (input: { storeId?: string; from: string; to: string }) => {
  const api = useApi();
  const search = new URLSearchParams({
    from: input.from,
    to: input.to,
    ...(input.storeId && { store_id: input.storeId })
  });

  return useQuery({
    queryKey: ['admin', 'costs', input.storeId ?? null, input.from, input.to],
    queryFn: () => api<CostReport>('GET', `/admin/reports/cost?${search.toString()}`)
  });
};

export type ConversationFilter = 'all' | 'needs_human' | 'errors';

/**
 * Same as the API `PAGE_SIZE` (`src/admin/conversations/repository.ts`): a full page means there may be more.
 */
const CONVERSATIONS_PAGE_SIZE = 50;

export type AdminConversation = {
  id: string;
  store_id: string;
  store_name: string;
  customer_phone: string;
  mode: 'bot' | 'human';
  handoff_reason: string | null;
  last_message_at: string;
};

export type AdminConversationRow = AdminConversation & { preview: string };

/**
 * `args`: the JSON the model sent, as text (keys exactly as sent).
 */
export type AiToolTrace = { name: string; args: string | null; ok: boolean; error?: string };

export type AdminAiCall = {
  id: string;
  provider: 'anthropic' | 'jev' | 'openrouter';
  model: string;
  path: string;
  intent: string | null;
  confidence: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  prompt_version: string | null;
  tools: AiToolTrace[] | null;
  at: string;
};

export type AdminMessage = {
  id: string;
  incoming: boolean;
  author: 'customer' | 'bot' | 'staff';
  body: string;
  at: string;
};

/**
 * 50 per page, next page before the last row's `last_message_at`.
 */
export const useAdminConversations = (input: { storeId?: string; filter: ConversationFilter }) => {
  const api = useApi();

  return useInfiniteQuery({
    queryKey: ['admin', 'conversations', input.storeId ?? null, input.filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({
        filter: input.filter,
        ...(input.storeId && { store_id: input.storeId }),
        ...(pageParam && { before: pageParam })
      });

      return api<{ conversations: AdminConversationRow[] }>('GET', `/admin/conversations?${search.toString()}`);
    },
    getNextPageParam: (page) =>
      page.conversations.length === CONVERSATIONS_PAGE_SIZE ? page.conversations.at(-1)?.last_message_at : undefined
  });
};

/**
 * The simulation behind a conversation. `facts`: the scenario facts as JSON text.
 */
export type ConversationSimulation = {
  id: string;
  run_id: string;
  run_name: string;
  scenario_id: string;
  title: string;
  persona: string | null;
  goal: string | null;
  facts: string;
  repeat_index: number;
  status: SimulationStatus;
  turns: number;
  checks: SimulationCheck[];
  error: string | null;
  customer_model: string;
  customer_cost_usd: number;
  judge_cost_usd: number;
};

export type AdminConversationDetail = {
  conversation: AdminConversation;
  messages: AdminMessage[];
  ai_calls: AdminAiCall[];
  simulation: ConversationSimulation | null;
};

export const useAdminConversation = (conversationId: string) => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'conversations', 'detail', conversationId],
    queryFn: () => api<AdminConversationDetail>('GET', `/admin/conversations/${conversationId}`)
  });
};

export type SimulationStatus = 'running' | 'passed' | 'failed' | 'error';

export type SimulationRun = {
  id: string;
  store_id: string;
  store_name: string;
  name: string;
  total: number;
  prompt_version: string;
  router: RouterType;
  llm_model: string;
  customer_model: string;
  created_at: string;
  finished_at: string | null;
};

export type SimulationRunRow = SimulationRun & { passed: number; failed: number; errors: number; running: number };

export type SimulationCheck = { name: string; pass: boolean; expected: string; actual: string };

export type SimulationResult = {
  id: string;
  scenario_id: string;
  title: string;
  repeat_index: number;
  conversation_id: string | null;
  status: SimulationStatus;
  turns: number;
  checks: SimulationCheck[];
  error: string | null;
  ai_calls: number;
  bot_cost_usd: number;
  customer_cost_usd: number;
  judge_cost_usd: number;
  billing_percent: number | null;
  billing_cents: number;
  created_at: string;
  finished_at: string | null;
};

export type ScenarioSummary = { id: string; title: string; scripted: boolean; repeat: number; max_turns: number };

export type ScenarioError = { path: string; message: string };

export const useSimulationRuns = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'simulations'],
    queryFn: () => api<{ runs: SimulationRunRow[]; customer_models: string[] }>('GET', '/admin/simulations')
  });
};

/**
 * Polls while any simulation still runs.
 */
export const useSimulationRun = (runId: string) => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'simulations', runId],
    queryFn: () =>
      api<{ run: SimulationRun & { source: string }; simulations: SimulationResult[] }>(
        'GET',
        `/admin/simulations/${runId}`
      ),
    refetchInterval: (query) => (query.state.data?.run.finished_at ? false : 5_000)
  });
};

export const useValidateScenarios = () => {
  const api = useApi();

  return useMutation({
    mutationFn: (source: string) =>
      api<{ scenarios: ScenarioSummary[]; errors: ScenarioError[] }>('POST', '/admin/simulations/validate', { source })
  });
};

export const useStartSimulation = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { storeId: string; name: string; source: string; customerModel: string }) =>
      api<{ run_id: string }>('POST', '/admin/simulations', {
        store_id: input.storeId,
        name: input.name || undefined,
        source: input.source,
        customer_model: input.customerModel || undefined
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'simulations'] })
  });
};

export const useAdminPrompt = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'prompt'],
    queryFn: () => api<{ version: string; system: string; reply: string; tools: string }>('GET', '/admin/prompt')
  });
};

export type OrderStep = 'items' | 'fulfillment' | 'address' | 'payment' | 'placed';

export type Dashboard = {
  month: string;
  current: boolean;
  price_cents: number;
  totals: {
    conversations: number;
    placed_by_bot: number;
    placed_by_store: number;
    placed_by_web: number;
    handoffs: number;
    abandoned: number;
    failures: number;
    cost_cents: number;
    forecast_cents: number | null;
    cost_per_order_cents: number | null;
  };
  days: { date: string; orders: number; conversations: number; cost_cents: number }[];
  funnel: { step: 'conversation' | OrderStep; count: number }[];
  handoff_reasons: { reason: string; count: number }[];
};

/**
 * One billing month (YYYY-MM) of the store.
 */
export const useDashboard = (month: string) => {
  const api = useApi();

  return useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api<Dashboard>('GET', `/panel/dashboard?month=${month}`)
  });
};

export type ProspectStatus =
  'available' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'canceled' | 'manual';

export type ProspectPauseReason = 'manual' | 'disconnected' | 'failures' | 'low_replies';

export type ProspectingSummary = {
  sender: {
    connected: boolean;
    paused: boolean;
    pause_reason: ProspectPauseReason | null;
    max_daily: number;
    window: { start_hour: number; end_hour: number; weekdays: number[] };
    next_send_at: string | null;
  };
  counts: Record<ProspectStatus, number>;
  sent_today: number;
  cap_today: number;
  /**
   * Replied ÷ leads we messaged; null before the first send.
   */
  reply_rate: number | null;
};

export type ProspectSituation = 'whatsapp' | 'online_order' | 'marketplace' | 'competitor' | 'none';

export type ProspectSystem = { name: string; kind: 'bot' | 'market' | 'whats' | 'other'; source?: string };

export type ProspectLead = {
  id: string;
  name: string;
  phone: string;
  info: Record<string, string | number>;
  messages: string[];
  sent_message: string | null;
  status: ProspectStatus;
  /**
   * `sending` for too long: the result is unknown.
   */
  stuck: boolean;
  failure_reason: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  note: string | null;
  position: number;
  category: string | null;
  neighborhood: string | null;
  zone: string | null;
  city: string | null;
  postal_code: string | null;
  situation: ProspectSituation | null;
  systems: ProspectSystem[] | null;
  rating: number | null;
  reviews: number | null;
  score: number | null;
  site: string | null;
  mobile: boolean | null;
  queued_at: string | null;
};

export type ProspectImportResult = {
  import_id: string;
  total: number;
  added: number;
  skipped_duplicate: number;
  skipped_invalid: number;
  errors: { row: number; reason: string }[];
};

export type ProspectPlace = { city?: string; zone?: string; neighborhood?: string };

export type ProspectFilters = ProspectPlace & {
  status?: ProspectStatus;
  q?: string;
  category?: string;
  situation?: ProspectSituation;
  mobile?: boolean;
  sort?: 'score' | 'reviews' | 'name';
};

export type ProspectsOverview = {
  situations: Record<ProspectSituation | 'unknown', number>;
  statuses: Record<ProspectStatus, number>;
  places: { city: string; zone: string | null; neighborhood: string | null }[];
  categories: string[];
};

export type ProspectingUpdate = {
  paused?: boolean;
  max_daily?: number;
  window?: { start_hour: number; end_hour: number; weekdays: number[] };
};

export const useProspecting = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'prospecting', 'summary'],
    queryFn: () => api<ProspectingSummary>('GET', '/admin/prospecting'),
    refetchInterval: 30_000
  });
};

export const useUpdateProspecting = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProspectingUpdate) => api<ProspectingSummary>('PATCH', '/admin/prospecting', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prospecting'] })
  });
};

/**
 * WhatsApp hooks of the prospecting number, same shape as the store's own (`WhatsAppHooks`).
 */
export const prospectingWhatsAppHooks = {
  useState: (poll: boolean) => {
    const api = useApi();

    return useQuery({
      queryKey: ['admin', 'prospecting', 'whatsapp'],
      queryFn: () => api<{ state: WhatsAppState }>('GET', '/admin/prospecting/whatsapp'),
      refetchInterval: poll ? 3_000 : false
    });
  },
  useConnect: () => {
    const api = useApi();

    return useMutation({
      mutationFn: () =>
        api<{ qr_base64: string | null; pairing_code: string | null }>('POST', '/admin/prospecting/whatsapp/connect')
    });
  },
  useDisconnect: () => {
    const api = useApi();
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: () => api<{ state: WhatsAppState }>('POST', '/admin/prospecting/whatsapp/disconnect'),
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prospecting'] })
    });
  }
};

/**
 * The API takes at most this many leads per request (`MAX_IMPORT_ROWS`); a bigger file is sent in parts.
 */
const IMPORT_PART_SIZE = 2_000;

export type ProspectImportInput = { body: unknown; onPart?: (part: number, parts: number) => void };

export const useImportProspects = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ body, onPart }: ProspectImportInput) => {
      const leads = (body as { leads?: unknown } | null)?.leads;

      if (!Array.isArray(leads) || leads.length <= IMPORT_PART_SIZE) {
        return api<ProspectImportResult>('POST', '/admin/prospecting/imports', body);
      }

      const parts = Math.ceil(leads.length / IMPORT_PART_SIZE);
      let sum: ProspectImportResult | null = null;

      // One part at a time: the API serializes imports anyway, and a failed part leaves the earlier ones stored
      // (importing the file again skips them as duplicates).
      for (let part = 0; part < parts; part++) {
        onPart?.(part + 1, parts);

        const start = part * IMPORT_PART_SIZE;
        const result = await api<ProspectImportResult>('POST', '/admin/prospecting/imports', {
          leads: leads.slice(start, start + IMPORT_PART_SIZE)
        });

        const errors = result.errors.map((error) => ({ ...error, row: error.row + start }));

        sum = sum
          ? {
              import_id: result.import_id,
              total: sum.total + result.total,
              added: sum.added + result.added,
              skipped_duplicate: sum.skipped_duplicate + result.skipped_duplicate,
              skipped_invalid: sum.skipped_invalid + result.skipped_invalid,
              errors: [...sum.errors, ...errors]
            }
          : { ...result, errors };
      }

      return sum!;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prospecting'] })
  });
};

/**
 * Empty filters are left out: the API rejects '' for its enum params.
 */
const prospectParams = (filters: ProspectFilters) => {
  const params = new URLSearchParams();

  for (const key of ['status', 'q', 'city', 'zone', 'neighborhood', 'category', 'situation', 'sort'] as const) {
    if (filters[key]) {
      params.set(key, filters[key]);
    }
  }

  if (filters.mobile) {
    params.set('mobile', 'true');
  }

  return params;
};

const prospectSearch = (filters: ProspectFilters, cursor?: number) => {
  const params = prospectParams(filters);

  if (cursor !== undefined) {
    params.set('cursor', String(cursor));
  }

  return params.toString();
};

type ProspectPage = { leads: ProspectLead[]; next_cursor: number | null; total: number };

/**
 * 100 per page, best score first by default; the next page continues after `next_cursor`.
 */
export const useProspects = (filters: ProspectFilters) => {
  const api = useApi();

  return useInfiniteQuery({
    queryKey: ['admin', 'prospecting', 'leads', prospectSearch(filters)],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api<ProspectPage>('GET', `/admin/prospecting/leads?${prospectSearch(filters, pageParam)}`),
    getNextPageParam: (page) => page.next_cursor ?? undefined
  });
};

/**
 * Every lead id of the filter, walking all pages (for "select all of the filter").
 */
export const useFetchProspectIds = () => {
  const api = useApi();

  return async (filters: ProspectFilters) => {
    const ids: string[] = [];
    let cursor: number | undefined;

    do {
      const page = await api<ProspectPage>('GET', `/admin/prospecting/leads?${prospectSearch(filters, cursor)}`);

      ids.push(...page.leads.map((lead) => lead.id));
      cursor = page.next_cursor ?? undefined;
    } while (cursor !== undefined);

    return ids;
  };
};

/**
 * Counts by situation and status inside a place, plus the places and categories for the filter selects.
 */
export const useProspectsOverview = (place: ProspectPlace) => {
  const api = useApi();
  const search = prospectParams(place).toString();

  return useQuery({
    queryKey: ['admin', 'prospecting', 'overview', search],
    queryFn: () => api<ProspectsOverview>('GET', `/admin/prospecting/leads/overview?${search}`),
    placeholderData: keepPreviousData
  });
};

/**
 * Queues the best available leads (20) of the filters, no selection needed.
 */
export const useQueueBestProspects = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filters: ProspectFilters) => {
      const { status: _status, sort: _sort, mobile, ...rest } = filters;

      return api<{ queued: number }>('POST', '/admin/prospecting/leads/queue-best', {
        ...Object.fromEntries(prospectParams(rest)),
        ...(mobile && { mobile: true })
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prospecting'] })
  });
};

export const useUpdateProspect = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; note?: string | null; status?: ProspectStatus }) =>
      api<ProspectLead>('PATCH', `/admin/prospecting/leads/${input.id}`, {
        note: input.note,
        status: input.status
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prospecting'] })
  });
};

/**
 * Most ids the bulk route takes per request.
 */
const PROSPECT_BULK_BATCH = 2000;

/**
 * Sends the ids in batches the route accepts, one after the other, and sums the results. A failed batch leaves the
 * earlier ones applied, so the list is refreshed either way.
 */
export const useBulkUpdateProspects = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { ids: string[]; status: 'available' | 'queued' | 'canceled' | 'manual' }) => {
      const total = { updated: 0, skipped: 0 };

      for (let from = 0; from < input.ids.length; from += PROSPECT_BULK_BATCH) {
        const { updated, skipped } = await api<{ updated: number; skipped: number }>(
          'POST',
          '/admin/prospecting/leads/bulk',
          { ids: input.ids.slice(from, from + PROSPECT_BULK_BATCH), status: input.status }
        );

        total.updated += updated;
        total.skipped += skipped;
      }

      return total;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prospecting'] })
  });
};

export type StockPackage = { id: string; name: string; factor: number; barcode: string | null };

export type StockItem = {
  id: string;
  name: string;
  unit: StockUnit;
  barcode: string | null;
  balance: number;
  min_qty: number | null;
  /**
   * Millicents per base unit (g, ml, un).
   */
  avg_cost_millicents: number;
  archived_at: string | null;
  low: boolean;
};

export type StockMovement = {
  id: string;
  kind: string;
  qty_delta: number;
  balance_after: number;
  unit_cost_millicents: number | null;
  order_id: string | null;
  reason: string | null;
  note: string | null;
  author: string | null;
  created_at: string;
};

export type StockLink = { product_id: string | null; option_id: string | null; name: string; qty: number };

export type StockItemDetail = {
  item: StockItem;
  packages: StockPackage[];
  links: StockLink[];
};

export type StockItemInput = {
  name: string;
  unit: StockUnit;
  barcode: string | null;
  min_qty: number | null;
  packages: { id?: string; name: string; factor: number; barcode: string | null }[];
};

export const useStockItems = (filter: StockFilter) => {
  const api = useApi();

  return useQuery({
    queryKey: ['stock', 'items', filter],
    queryFn: () => api<{ items: StockItem[] }>('GET', `/panel/stock/items?filter=${filter}`)
  });
};

export const useStockSummary = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['stock', 'summary'],
    queryFn: () => api<{ low: number; sold_out: number }>('GET', '/panel/stock/summary')
  });
};

/**
 * One item with its links and movements; `fetchNextPage` loads older movements.
 */
export const useStockItem = (id: string | undefined) => {
  const api = useApi();

  return useInfiniteQuery({
    queryKey: ['stock', 'item', id],
    enabled: !!id,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      if (pageParam) {
        const page = await api<{ movements: StockMovement[]; next: string | null }>(
          'GET',
          `/panel/stock/items/${id}/movements?before=${encodeURIComponent(pageParam)}`
        );

        return { detail: undefined, ...page };
      }

      const { movements, next, ...detail } = await api<
        StockItemDetail & { movements: StockMovement[]; next: string | null }
      >('GET', `/panel/stock/items/${id}`);

      return { detail, movements, next };
    },
    getNextPageParam: (page) => page.next ?? undefined
  });
};

export const useFindStockBarcode = () => {
  const api = useApi();

  return (code: string) =>
    api<{ item: StockItem; package?: StockPackage }>('GET', `/panel/stock/barcode/${encodeURIComponent(code)}`);
};

const useStockMutation = <TInput, TOutput>(
  request: (api: ReturnType<typeof useApi>, input: TInput) => Promise<TOutput>
) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => request(api, input),
    // Stock changes the sold-out flags of the menu.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stock'] }),
        queryClient.invalidateQueries({ queryKey: ['menu'] })
      ])
  });
};

export const useCreateStockItem = () =>
  useStockMutation((api, input: StockItemInput) =>
    api<{ item: StockItem; packages: StockPackage[] }>('POST', '/panel/stock/items', input)
  );

export const useUpdateStockItem = () =>
  useStockMutation((api, input: { id: string; input: StockItemInput }) =>
    api<{ item: StockItem; packages: StockPackage[] }>('PUT', `/panel/stock/items/${input.id}`, input.input)
  );

export const useArchiveStockItem = () =>
  useStockMutation((api, id: string) => api<{ archived: true }>('POST', `/panel/stock/items/${id}/archive`));

export const useRecordStockEntry = () =>
  useStockMutation((api, input: { item_id: string; package_id?: string; qty: number; total_cost_cents?: number }) =>
    api<{ recorded: true }>('POST', '/panel/stock/entries', input)
  );

export const useRecordStockLoss = () =>
  useStockMutation((api, input: { item_id: string; qty: number; reason: LossReason; note?: string }) =>
    api<{ recorded: true }>('POST', '/panel/stock/losses', input)
  );

export const useRecordStockCount = () =>
  useStockMutation((api, input: { item_id: string; counted: number }) =>
    api<{ recorded: true }>('POST', '/panel/stock/counts', { counts: [input] })
  );

/**
 * One stock item a product or option consumes, `qty` in the item's base unit.
 */
export type StockLinkDraft = { stock_item_id: string; name: string; unit: StockUnit; qty: number };

/**
 * Links changed in the product form, saved after the product. Options are addressed by position, like photos.
 */
export type PendingLinks = {
  product?: StockLinkDraft[];
  options: { group: number; option: number; links: StockLinkDraft[] }[];
};

export const hasPendingLinks = (links: PendingLinks) => !!links.product || links.options.length > 0;

/**
 * Current links of a product (`product:<id>`) and of each of its options (`option:<id>`), from one request.
 */
export const useProductStockLinks = (productId: string | undefined) => {
  const api = useApi();

  const query = useQuery({
    queryKey: ['stock', 'links', productId],
    enabled: !!productId,
    queryFn: () =>
      api<{ product: StockLinkDraft[]; options: { option_id: string; links: StockLinkDraft[] }[] }>(
        'GET',
        `/panel/menu/products/${productId}/stock-links`
      )
  });

  const index = new Map<string, StockLinkDraft[]>();

  if (productId && query.data) {
    index.set(`product:${productId}`, query.data.product);

    for (const { option_id, links } of query.data.options) {
      index.set(`option:${option_id}`, links);
    }
  }

  return { index, isPending: !!productId && query.isPending, isError: query.isError };
};

/**
 * Saves the links after the product itself (one request per changed target).
 */
export const useSaveStockLinks = () =>
  useStockMutation(async (api, { product, links }: { product: MenuProduct; links: PendingLinks }) => {
    const body = (list: StockLinkDraft[]) => ({
      links: list.map(({ stock_item_id, qty }) => ({ stock_item_id, qty }))
    });

    if (links.product) {
      await api('PUT', `/panel/menu/products/${product.id}/stock-links`, body(links.product));
    }

    for (const { group, option, links: list } of links.options) {
      const id = product.groups[group]?.options[option]?.id;

      if (id) {
        await api('PUT', `/panel/menu/options/${id}/stock-links`, body(list));
      }
    }
  });
