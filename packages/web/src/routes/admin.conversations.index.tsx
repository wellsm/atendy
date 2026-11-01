import type { ConversationFilter } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { formatPhone, formatWhen, handoffLabel } from '../lib/format';
import { useAdminConversations, useAdminStores } from '../lib/queries';

export const Route = createFileRoute('/admin/conversations/')({
  component: () => (
    <SignedIn>
      <ConversationsPage />
    </SignedIn>
  )
});

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-accent focus:outline-none';

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'needs_human', label: 'Com atendente' },
  { value: 'errors', label: 'Com erro' }
];

function ConversationsPage() {
  const stores = useAdminStores();
  const [storeId, setStoreId] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const conversations = useAdminConversations({ storeId: storeId || undefined, filter });
  const rows = conversations.data?.pages.flatMap((page) => page.conversations) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-sm text-neutral-500">
            ← Lojas
          </Link>
          <h1 className="text-xl font-semibold">Conversas</h1>
        </div>
        <UserButton />
      </header>

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className={INPUT}>
          <option value="">Todas as lojas</option>
          {stores.data?.stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as ConversationFilter)}
          className={INPUT}
        >
          {FILTERS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {conversations.isPending && <Loading />}
      {conversations.isError && <p className="text-sm text-red-700">Não foi possível carregar as conversas.</p>}
      {conversations.isSuccess && !rows.length && <p className="text-sm text-neutral-600">Nenhuma conversa.</p>}

      {rows.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to="/admin/conversations/$conversationId"
                params={{ conversationId: row.id }}
                className="flex flex-col gap-1 p-4 hover:bg-neutral-50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {row.store_name} · {formatPhone(row.customer_phone)}
                  </span>
                  <span className="text-neutral-500">{formatWhen(row.last_message_at)}</span>
                </div>
                <p className="truncate text-sm text-neutral-600">{row.preview}</p>
                {row.mode === 'human' && (
                  <span className="text-xs font-medium text-amber-700">{handoffLabel(row.handoff_reason)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {conversations.hasNextPage && (
        <button
          type="button"
          disabled={conversations.isFetchingNextPage}
          onClick={() => void conversations.fetchNextPage()}
          className="mt-4 rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          {conversations.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
}
