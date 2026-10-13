import type { ReactNode } from 'react';
import type { PanelStore } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { Link } from '@tanstack/react-router';

import { useUpdateStore } from '../lib/queries';

const NAV = [
  { to: '/', label: 'Pedidos' },
  { to: '/conversas', label: 'Conversas' },
  { to: '/cardapio', label: 'Cardápio' },
  { to: '/configuracoes', label: 'Configurações' },
  { to: '/whatsapp', label: 'WhatsApp' }
] as const;

/**
 * The store's own on/off switch, plus why the bot still refuses when the hours say closed.
 */
function AcceptingSwitch({ store }: { store: PanelStore }) {
  const update = useUpdateStore();
  const accepting = update.isPending ? !store.accepting_orders : store.accepting_orders;

  return (
    <div className="flex flex-col items-end gap-0.5 md:items-stretch">
      <button
        type="button"
        role="switch"
        aria-checked={accepting}
        disabled={update.isPending}
        onClick={() => update.mutate({ accepting_orders: !store.accepting_orders })}
        className="flex items-center gap-2 text-sm disabled:opacity-60"
      >
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${accepting ? 'bg-green-600' : 'bg-neutral-300'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${accepting ? 'left-4.5' : 'left-0.5'}`}
          />
        </span>
        <span className={accepting ? 'font-medium text-green-800' : 'text-neutral-600'}>
          {accepting ? 'Aceitando pedidos' : 'Pedidos pausados'}
        </span>
      </button>
      {accepting && !store.open_now && <span className="text-xs text-amber-700">Fechada pelo horário</span>}
      {update.isError && <span className="text-xs text-red-700">Não foi possível alterar.</span>}
    </div>
  );
}

/**
 * Desktop: fixed sidebar. Phone: top bar + bottom tabs.
 */
export function PanelShell({ store, children }: { store: PanelStore; children: ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex">
        <div className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-red-600">Atendy</p>
          <p className="truncate font-semibold">{store.name}</p>
          <div className="mt-3">
            <AcceptingSwitch store={store} />
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              activeProps={{ className: 'bg-red-50 font-medium text-red-700' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-4">
          <UserButton />
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <p className="min-w-0 truncate font-semibold">{store.name}</p>
        <div className="flex items-center gap-3">
          <AcceptingSwitch store={store} />
          <UserButton />
        </div>
      </header>

      <main className="flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-8">
        {!store.active && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Sua loja está aguardando ativação. Avisaremos quando estiver liberada.
          </div>
        )}
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-neutral-200 bg-white md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: true }}
            className="px-1 py-3 text-center text-xs text-neutral-600"
            activeProps={{ className: 'font-semibold text-red-700' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
