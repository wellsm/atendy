import type { ConversationFilter } from '../lib/queries';

import { createFileRoute, Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { formatPhone, formatWhen, handoffLabel } from '../lib/format';
import { useAdminConversations, useAdminStores } from '../lib/queries';

type Show = Exclude<ConversationFilter, 'all'>;

/**
 * `store` and `show` (not `filter`: the panel's untyped search reducers see every route's keys, and `filter` is the
 * stock sheet's) keep the list in the URL, so the store page can link "conversations with errors" of one store.
 */
type ConversationsSearch = { store?: string; show?: Show };

const FILTERS: { value: Show | undefined; label: string }[] = [
  { value: undefined, label: 'Todas' },
  { value: 'needs_human', label: 'Com atendente' },
  { value: 'errors', label: 'Com erro' },
  { value: 'simulations', label: 'Simulações' }
];

const isShow = (value: unknown): value is Show =>
  FILTERS.some((filter) => filter.value !== undefined && filter.value === value);

export const Route = createFileRoute('/admin/conversations')({
  validateSearch: (search: Record<string, unknown>): ConversationsSearch => ({
    ...(typeof search.store === 'string' && search.store && { store: search.store }),
    ...(isShow(search.show) && { show: search.show })
  }),
  component: ConversationsLayout
});

/**
 * List on the left, the open conversation on the right; on phones one or the other.
 */
function ConversationsLayout() {
  const { conversationId } = useParams({ strict: false });

  return (
    <div className="md:flex md:h-screen">
      <div
        className={`flex-col border-line bg-surface md:flex md:w-96 md:shrink-0 md:border-r ${conversationId ? 'hidden' : 'flex'}`}
      >
        <ConversationList openId={conversationId} />
      </div>
      <div className={`min-w-0 flex-1 md:block md:overflow-y-auto ${conversationId ? 'block' : 'hidden'}`}>
        <Outlet />
      </div>
    </div>
  );
}

function ConversationList({ openId }: { openId?: string }) {
  const { store, show } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stores = useAdminStores();
  const conversations = useAdminConversations({ storeId: store, filter: show ?? 'all' });
  const rows = conversations.data?.pages.flatMap((page) => page.conversations) ?? [];

  return (
    <>
      <header className="flex flex-col gap-3 border-b border-line px-4 pt-6 pb-3">
        <h1 className="text-xl font-semibold">Conversas</h1>
        <select
          value={store ?? ''}
          onChange={(event) =>
            void navigate({ search: (previous) => ({ ...previous, store: event.target.value || undefined }) })
          }
          aria-label="Loja"
          className="rounded-md border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">Todas as lojas</option>
          {stores.data?.stores.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={show === value}
              onClick={() => void navigate({ search: (previous) => ({ ...previous, show: value }) })}
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                show === value ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2 hover:bg-line'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {conversations.isPending && <Loading />}
        {conversations.isError && <p className="p-4 text-sm text-danger-fg">Não foi possível carregar as conversas.</p>}
        {conversations.isSuccess && !rows.length && <p className="p-4 text-sm text-fg-2">Nenhuma conversa.</p>}

        {rows.length > 0 && (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  to="/admin/conversations/$conversationId"
                  params={{ conversationId: row.id }}
                  search={true}
                  aria-current={row.id === openId ? 'page' : undefined}
                  className={`flex flex-col gap-1 border-l-[3px] px-4 py-3 ${
                    row.id === openId ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-hover'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">
                      {row.store_name} · {formatPhone(row.customer_phone)}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{formatWhen(row.last_message_at)}</span>
                  </span>
                  <span className="truncate text-[13px] text-fg-2">{row.preview}</span>
                  {(row.mode === 'human' || row.error || row.simulation) && (
                    <span className="flex flex-wrap gap-1 text-[11px] font-medium">
                      {row.mode === 'human' && (
                        <span className="rounded-full bg-accepted-bg px-2 py-px text-warn-fg">
                          {handoffLabel(row.handoff_reason)}
                        </span>
                      )}
                      {row.error && <span className="rounded-full bg-danger-soft px-2 py-px text-danger-fg">Erro</span>}
                      {row.simulation && (
                        <span className="rounded-full bg-out-bg px-2 py-px text-out-fg">Simulação</span>
                      )}
                    </span>
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
            className="m-4 rounded-md border border-line-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            {conversations.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>
    </>
  );
}
