import { useAuth, useOrganizationList } from '@clerk/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from './api';

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

export type AdminStore = PanelStore & {
  created_at: string;
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
export const useCreateStore = () => {
  const api = useApi();
  const { orgId } = useAuth();
  const { createOrganization, setActive } = useOrganizationList();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string }) => {
      if (!orgId) {
        if (!createOrganization || !setActive) {
          throw new Error('Clerk is not loaded');
        }

        const organization = await createOrganization({ name: input.name });

        await setActive({ organization: organization.id });
      }

      return api<{ store: PanelStore }>('POST', '/panel/stores', { name: input.name, accept_risk: true });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] })
  });
};

export const useAdminStores = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['admin', 'stores'],
    queryFn: () => api<{ stores: AdminStore[] }>('GET', '/admin/stores')
  });
};

export const useSetStoreActive = () => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { storeId: string; active: boolean }) =>
      api<{ store: AdminStore }>('PATCH', `/admin/stores/${input.storeId}`, { active: input.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
  });
};

export type OrderStatus = 'placed' | 'accepted' | 'out' | 'done' | 'canceled';

export type PanelOrder = {
  id: string;
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
  amended_at: string | null;
  conversation_id: string;
  customer: { name: string | null; phone: string };
  items: { id: string; name: string; qty: number; options: string; notes: string | null; unit_price_cents: number }[];
};

export type OrderScope = 'open' | 'closed';

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
  last_message_at: string;
  customer: { name: string | null; phone: string };
};

export type PanelMessage = {
  id: string;
  author: 'customer' | 'bot' | 'staff';
  body: string;
  created_at: string;
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
      api<{ conversation: PanelConversation; messages: PanelMessage[] }>(
        'GET',
        `/panel/conversations/${conversationId}`
      ),
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

export type DeliveryMode = 'flat' | 'by_zone';

export type HourRange = {
  /**
   * 0 = Sunday … 6 = Saturday.
   */
  weekday: number;
  opens_at: string;
  closes_at: string;
};

export type DeliveryZone = { neighborhood: string; fee_cents: number };

export type DeliverySettings = { mode: DeliveryMode; flat_fee_cents: number; zones: DeliveryZone[] };

export type PolicySettings = {
  min_order_cents: number | null;
  max_order_cents: number | null;
  max_change_cents: number | null;
  max_item_qty: number | null;
  new_customer_review_cents: number | null;
  last_order_minutes: number | null;
  sop: string | null;
};

export type Settings = {
  hours: HourRange[];
  delivery: DeliverySettings;
  payment_methods: PaymentMethod[];
  policy: PolicySettings;
};

export const useSettings = () => {
  const api = useApi();

  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('GET', '/panel/settings')
  });
};

const useSettingsMutation = <TInput, TOutput>(method: 'PUT' | 'PATCH', path: string) => {
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

export const useUpdatePayment = () =>
  useSettingsMutation<{ payment_methods: PaymentMethod[] }, { payment_methods: PaymentMethod[] }>(
    'PUT',
    '/panel/settings/payment'
  );

export const useUpdatePolicy = () =>
  useSettingsMutation<Partial<PolicySettings>, { policy: PolicySettings }>('PATCH', '/panel/settings/policy');

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
  groups: MenuGroup[];
};

export type MenuCategory = {
  id: string;
  name: string;
  products: MenuProduct[];
};

/**
 * A product saved whole. Groups and options without `id` are new; with `id` they keep it. `active` goes only when the
 * form changed it, so a sold-out toggle made meanwhile survives the save.
 */
export type ProductInput = Omit<MenuProduct, 'id' | 'active' | 'groups'> & {
  active?: boolean;
  groups: (Omit<MenuGroup, 'id' | 'options'> & {
    id?: string;
    options: (Omit<MenuOption, 'id' | 'active'> & { id?: string; active?: boolean })[];
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
