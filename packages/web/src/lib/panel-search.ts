import type { StockFilter } from './stock';

import { getRouteApi, useNavigate } from '@tanstack/react-router';

import { usePanelSlug } from './panel-slug';

export type Sheet = 'menu' | 'whatsapp' | 'settings' | 'billing' | 'history' | 'dashboard' | 'stock';

export type PanelView = 'orders';

export type SettingsTab = 'store' | 'hours' | 'delivery' | 'payment' | 'policy' | 'stock' | 'pos';

/**
 * The panel page state in the URL: the main view (conversations, or `view=orders` for the kitchen board), the open
 * conversation (`c`) and the open side sheet. `product` (`new` or an id)
 * edits a product inside the menu sheet; `photo=failed` means it was created but a photo upload failed; `groups` shows
 * the menu's option groups library.
 */
export type PanelSearch = {
  view?: PanelView;
  c?: string;
  sheet?: Sheet;
  product?: string;
  category?: string;
  photo?: 'failed';
  groups?: true;
  tab?: SettingsTab;
  item?: string;
  filter?: StockFilter;
};

const SHEETS: Sheet[] = ['menu', 'whatsapp', 'settings', 'billing', 'history', 'dashboard', 'stock'];

const STOCK_FILTER_VALUES: StockFilter[] = ['low', 'sold_out', 'archived'];

const TABS: SettingsTab[] = ['store', 'hours', 'delivery', 'payment', 'policy', 'stock', 'pos'];

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const validatePanelSearch = (search: Record<string, unknown>): PanelSearch => ({
  ...(search.view === 'orders' && { view: 'orders' as const }),
  ...(text(search.c) && { c: text(search.c) }),
  ...(SHEETS.includes(search.sheet as Sheet) && { sheet: search.sheet as Sheet }),
  ...(text(search.product) && { product: text(search.product) }),
  ...(text(search.category) && { category: text(search.category) }),
  ...(search.photo === 'failed' && { photo: 'failed' as const }),
  ...(search.groups === true && { groups: true as const }),
  ...(TABS.includes(search.tab as SettingsTab) && { tab: search.tab as SettingsTab }),
  ...(text(search.item) && { item: text(search.item) }),
  ...(STOCK_FILTER_VALUES.includes(search.filter as StockFilter) && { filter: search.filter as StockFilter })
});

const panelRoute = getRouteApi('/panel/$slug/');

export const usePanelSearch = () => panelRoute.useSearch();

/**
 * Keeps the view and the open conversation; opening a conversation (`c`) goes back to the conversations view.
 */
export const keepPanelState = (previous: PanelSearch, patch: PanelSearch): PanelSearch =>
  patch.c ? patch : { ...(previous.view && { view: previous.view }), ...(previous.c && { c: previous.c }), ...patch };

/**
 * Changes the panel search params (see `keepPanelState`).
 */
export const usePanelNavigate = () => {
  const slug = usePanelSlug();
  const navigate = useNavigate();

  return (patch: PanelSearch, options: { replace?: boolean } = {}) =>
    navigate({
      to: '/panel/$slug',
      params: { slug },
      search: (previous: PanelSearch) => keepPanelState(previous, patch),
      replace: options.replace
    });
};
