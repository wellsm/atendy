import type { ReactNode } from 'react';
import type { PanelSearch, PanelView, Sheet } from '../lib/panel-search';
import type { PanelOrder, PanelStore, WhatsAppState } from '../lib/queries';
import type { Theme } from '../lib/theme';

import { UserButton } from '@clerk/react';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { needsPerson } from './conversations/customer';
import { GlobalSearch } from './global-search';
import { SoundToggle } from './sound-toggle';
import { StoreMenu } from './store-menu';
import { formatMoney } from '../lib/format';
import { keepPanelState } from '../lib/panel-search';
import { usePanelSlug } from '../lib/panel-slug';
import {
  useBilling,
  useConversations,
  useMenu,
  useOrders,
  useStockSummary,
  useUpdateStore,
  useWhatsAppState
} from '../lib/queries';
import { usePanelTheme } from '../lib/theme';

const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long' });

const WHATSAPP: Record<WhatsAppState, { label: string; dot: string }> = {
  connected: { label: 'Conectado', dot: 'bg-on' },
  connecting: { label: 'Aguardando leitura do QR', dot: 'bg-amber-500' },
  disconnected: { label: 'Desconectado', dot: 'bg-faint' },
  not_created: { label: 'Não conectado', dot: 'bg-faint' }
};

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

/**
 * The store's own on/off switch, plus why the bot still refuses when the hours say closed.
 */
function AcceptingSwitch({ store }: { store: PanelStore }) {
  const update = useUpdateStore();
  const accepting = update.isPending ? !store.accepting_orders : store.accepting_orders;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        role="switch"
        aria-checked={accepting}
        disabled={update.isPending}
        onClick={() => update.mutate({ accepting_orders: !store.accepting_orders })}
        className="flex items-center gap-2 text-sm disabled:opacity-60"
      >
        <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${accepting ? 'bg-on' : 'bg-off'}`}>
          <span
            className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${accepting ? 'left-4.5' : 'left-0.5'}`}
          />
        </span>
        <span className={accepting ? 'font-medium text-ok-fg' : 'text-muted'}>
          {accepting ? 'Aceitando pedidos' : 'Pedidos pausados'}
        </span>
      </button>
      {accepting && !store.open_now && <span className="text-xs text-warn-fg">Fechada pelo horário</span>}
      {update.isError && <span className="text-xs text-accent-fg">Não foi possível alterar.</span>}
    </div>
  );
}

/**
 * This month so far: orders, what Atendy costs and the forecast for the whole month at the same pace.
 */
function MonthCard({ onPick }: { onPick: () => void }) {
  const slug = usePanelSlug();
  const billing = useBilling();
  const now = new Date();
  const day = now.getDate();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const open = billing.data?.open;

  return (
    <div className="mx-3 mt-1 flex flex-col gap-3 rounded-xl border border-line bg-hover p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{MONTH.format(now)}</span>
        <span className="text-xs text-faint">
          dia {day} de {days}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5">
          {/* Billed cycles: placed orders and the handoffs the AI half-did, as on the billing sheet. */}
          <span className="text-xs text-muted">Atendimentos</span>
          <span className="text-[22px] font-bold tracking-tight">{open ? open.orders : '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">Custo Atendy</span>
          <span className="text-[22px] font-bold tracking-tight">{open ? formatMoney(open.amount_cents) : '—'}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="block h-1 overflow-hidden rounded bg-line">
          <span className="block h-full bg-accent" style={{ width: `${Math.round((day / days) * 100)}%` }} />
        </span>
        {billing.data && open && (
          <span className="text-xs leading-snug text-muted">
            Previsão do mês{' '}
            <b className="font-semibold text-fg">{formatMoney(Math.round((open.amount_cents / day) * days))}</b> ·{' '}
            {formatMoney(billing.data.price_cents)} por pedido
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Link
          to="/panel/$slug"
          params={{ slug }}
          search={(previous: PanelSearch) => keepPanelState(previous, { sheet: 'dashboard' })}
          onClick={onPick}
          className="text-[13px] font-medium text-accent-fg"
        >
          Desempenho →
        </Link>
        <Link
          to="/panel/$slug"
          params={{ slug }}
          search={(previous: PanelSearch) => keepPanelState(previous, { sheet: 'history' })}
          onClick={onPick}
          className="text-[13px] font-medium text-accent-fg"
        >
          Histórico →
        </Link>
      </div>
    </div>
  );
}

const VIEWS: { view: PanelView | undefined; label: string }[] = [
  { view: undefined, label: 'Atendimento' },
  { view: 'orders', label: 'Pedidos' }
];

/**
 * The main area: conversations (the attendant's screen) or the open orders board (the kitchen's). Each badge counts
 * what waits for someone there: conversations with a person, new orders.
 */
function ViewNav({ onPick }: { onPick: () => void }) {
  const slug = usePanelSlug();
  const { view } = useSearch({ strict: false });
  const conversations = useConversations();
  const openOrders = useOrders('open');
  const waiting = conversations.data?.conversations.filter(needsPerson).length ?? 0;
  const newOrders = openOrders.data?.orders.filter(({ status }) => status === 'placed').length ?? 0;

  return (
    <nav className="mx-3 mb-3 grid grid-cols-2 gap-1 rounded-[10px] bg-seg p-[3px]">
      {VIEWS.map((item) => {
        const count = item.view === 'orders' ? newOrders : waiting;

        return (
          <Link
            key={item.label}
            to="/panel/$slug"
            params={{ slug }}
            search={item.view ? { view: item.view } : {}}
            onClick={onPick}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm ${view === item.view ? 'bg-seg-on font-semibold text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted'}`}
          >
            {item.label}
            {count > 0 && (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SheetButton({
  sheet,
  title,
  subtitle,
  onPick
}: {
  sheet: Sheet;
  title: string;
  subtitle: ReactNode;
  onPick: () => void;
}) {
  const slug = usePanelSlug();

  return (
    <Link
      to="/panel/$slug"
      params={{ slug }}
      search={(previous: PanelSearch) => keepPanelState(previous, { sheet })}
      onClick={onPick}
      className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 hover:bg-hover"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted">{subtitle}</span>
      </span>
      <span className="text-faint">›</span>
    </Link>
  );
}

function Sidebar({ store, theme, onTheme, onPick }: SidebarProps) {
  const menu = useMenu();
  const whatsapp = useWhatsAppState(false);
  const billing = useBilling();
  const stock = useStockSummary();
  const products = menu.data?.categories.flatMap((category) => category.products) ?? [];
  const paused = products.filter(({ active }) => !active).length;
  const wa = whatsapp.data && WHATSAPP[whatsapp.data.state];
  const card = billing.data?.card;

  return (
    <>
      <div className="flex flex-col gap-[3px] px-5 pb-3.5 pt-[18px]">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-fg">Atendy</p>
        <StoreMenu name={store.name} />
        <a
          href={`/${store.slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-accent-fg hover:underline"
        >
          Ver cardápio público ↗
        </a>
        <div className="mt-2.5">
          <AcceptingSwitch store={store} />
        </div>
      </div>

      <ViewNav onPick={onPick} />

      <MonthCard onPick={onPick} />

      <nav className="flex flex-col gap-1.5 px-3 py-3.5">
        <SheetButton
          sheet="menu"
          title="Cardápio"
          subtitle={menu.data ? `${products.length} produtos · ${paused} pausados` : 'Produtos e preços'}
          onPick={onPick}
        />
        <SheetButton
          sheet="stock"
          title="Estoque"
          subtitle={
            stock.data ? (
              <>
                {stock.data.low > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                    {stock.data.low}
                  </span>
                )}
                {stock.data.low} baixos · {stock.data.sold_out} esgotados
              </>
            ) : (
              'Insumos e saldo'
            )
          }
          onPick={onPick}
        />
        <SheetButton
          sheet="whatsapp"
          title="WhatsApp"
          subtitle={
            wa ? (
              <>
                <span className={`size-[7px] shrink-0 rounded-full ${wa.dot}`} />
                {wa.label}
              </>
            ) : (
              'Conexão do número'
            )
          }
          onPick={onPick}
        />
        <SheetButton sheet="settings" title="Configurações" subtitle="Horários, entrega, pagamento" onPick={onPick} />
        <SheetButton
          sheet="billing"
          title="Pagamento"
          subtitle={
            billing.data?.blocked ? (
              <span className="text-accent-fg">Bloqueado por falta de pagamento</span>
            ) : card ? (
              `Cartão ${card.brand} •••• ${card.last4}`
            ) : (
              'Cadastre um cartão'
            )
          }
          onPick={onPick}
        />
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-3 border-t border-line p-3">
        <div className="grid grid-cols-2 rounded-lg bg-seg p-[3px]">
          {(['light', 'dark'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onTheme(value)}
              className={`h-[30px] rounded-md text-[13px] ${theme === value ? 'bg-seg-on text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted'}`}
            >
              {value === 'light' ? 'Claro' : 'Escuro'}
            </button>
          ))}
        </div>
        <div className="px-1">
          <UserButton showName />
        </div>
      </div>
    </>
  );
}

type SidebarProps = { store: PanelStore; theme: Theme; onTheme: (theme: Theme) => void; onPick: () => void };

/**
 * Today so far: orders placed today that were not canceled, open and closed.
 */
function TodaySummary({ orders }: { orders: PanelOrder[] }) {
  const today = orders.filter((order) => isToday(order.placed_at) && order.status !== 'canceled');

  return (
    <span className="hidden shrink-0 text-[13px] text-muted lg:inline">
      Hoje · <b className="font-semibold text-fg">{today.length}</b> pedidos ·{' '}
      <b className="font-semibold text-fg">{formatMoney(today.reduce((sum, order) => sum + order.total_cents, 0))}</b>
    </span>
  );
}

/**
 * Desktop: sidebar with the month and the sheets, header with search. Phone: the sidebar opens from the header.
 */
export function PanelShell({ store, children }: { store: PanelStore; children: ReactNode }) {
  const { theme, setTheme } = usePanelTheme();
  const [drawer, setDrawer] = useState(false);
  const conversations = useConversations();
  const openOrders = useOrders('open');
  const closedOrders = useOrders('closed');
  const orders = [...(openOrders.data?.orders ?? []), ...(closedOrders.data?.orders ?? [])];
  const sidebar = { store, theme, onTheme: setTheme, onPick: () => setDrawer(false) };

  return (
    <div className="flex h-dvh overflow-hidden bg-page text-fg">
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex">
        <Sidebar {...sidebar} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-overlay"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto bg-surface">
            <Sidebar {...sidebar} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 md:gap-4 md:px-5">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setDrawer(true)}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-xl text-fg-2 md:hidden"
          >
            ☰
          </button>
          <GlobalSearch conversations={conversations.data?.conversations ?? []} orders={orders} />
          <span className="hidden flex-1 lg:block" />
          <TodaySummary orders={orders} />
          <span className="hidden sm:block">
            <SoundToggle openOrders={openOrders.data?.orders} conversations={conversations.data?.conversations} />
          </span>
        </header>

        {!store.active && (
          <div className="shrink-0 border-b border-warn-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
            Sua loja está aguardando ativação. Avisaremos quando estiver liberada.
          </div>
        )}

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
