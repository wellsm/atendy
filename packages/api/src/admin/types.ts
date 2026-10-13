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
};

export const toAdminStore = (store: {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  accepting_orders: boolean;
  created_at: string;
}): AdminStore => ({
  id: store.id,
  name: store.name,
  slug: store.slug,
  active: store.active,
  acceptingOrders: store.accepting_orders,
  createdAt: store.created_at
});
