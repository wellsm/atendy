import type { FormEvent } from 'react';
import type { AdminStoreRow } from '../lib/queries';

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { ApiError } from '../lib/api';
import { useAdminStores, useCreateAdminStore, useSetStoreActive } from '../lib/queries';

export const Route = createFileRoute('/admin/')({
  component: () => (
    <SignedIn>
      <Admin />
    </SignedIn>
  )
});

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type Tab = 'pending' | 'active' | 'all';

const TAB_FILTERS: Record<Tab, (store: AdminStoreRow) => boolean> = {
  pending: (store) => !store.active,
  active: (store) => store.active,
  all: () => true
};

/**
 * Lower case without accents, so "acai" finds "Açaí".
 */
const searchKey = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// Desktop table columns: store, link, created at, status, action.
const COLUMNS = 'md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_160px_110px_120px] md:gap-3';

function Admin() {
  const stores = useAdminStores();
  const [tab, setTab] = useState<Tab>('pending');
  const forbidden = stores.error instanceof ApiError && stores.error.status === 403;

  const [query, setQuery] = useState('');
  const all = stores.data?.stores ?? [];
  const needle = searchKey(query);
  const visible = all
    .filter(TAB_FILTERS[tab])
    .filter((store) => !needle || searchKey(store.name).includes(needle) || store.slug.includes(needle));
  const withErrors = all.filter(({ error_count24h }) => error_count24h > 0);
  const summary: { label: string; value: number; hint: string; tone?: string }[] = [
    {
      label: 'Lojas ativas',
      value: all.filter(TAB_FILTERS.active).length,
      hint: `${all.filter((store) => store.active && store.accepting_orders).length} aceitando pedidos agora`
    },
    {
      label: 'Pendentes',
      value: all.filter(TAB_FILTERS.pending).length,
      hint: 'Aguardando ativação',
      tone: 'text-warn-fg'
    },
    {
      label: 'Com erro em 24h',
      value: withErrors.length,
      hint: `${withErrors.reduce((sum, { error_count24h }) => sum + error_count24h, 0)} erros no total`,
      tone: 'text-danger-fg'
    },
    {
      label: 'Pedidos 30 dias',
      value: all.reduce((sum, { orders30d }) => sum + orders30d, 0),
      hint: 'Bot, site, atendente e PDV'
    }
  ];
  const tabs: [Tab, string][] = [
    ['pending', `Pendentes · ${all.filter(TAB_FILTERS.pending).length}`],
    ['active', 'Ativas'],
    ['all', 'Todas']
  ];

  return (
    <div>
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-3 py-4 md:gap-5 md:p-8">
        <header className="flex flex-col gap-0.5 px-1 md:px-0">
          <h1 className="text-xl font-bold md:text-2xl">Lojas</h1>
          <p className="text-sm text-muted">Ative lojas novas, acompanhe a saúde e entre em cada uma.</p>
        </header>

        {stores.isSuccess && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            {summary.map(({ label, value, hint, tone }) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-3 md:p-4">
                <span className="text-xs text-muted">{label}</span>
                <span className={`text-xl font-bold md:text-2xl ${value && tone ? tone : 'text-fg'}`}>
                  {value.toLocaleString('pt-BR')}
                </span>
                <span className="hidden text-xs text-muted md:block">{hint}</span>
              </div>
            ))}
          </div>
        )}

        <NewStore />

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div className="grid grid-cols-3 rounded-lg border border-line bg-surface p-0.5 md:flex">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`h-9.5 rounded-md px-3.5 text-[13px] font-medium md:h-auto md:py-1.5 md:text-sm ${
                  tab === id ? 'bg-accent text-white' : 'text-fg-2 hover:bg-surface-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar loja ou endereço"
            aria-label="Buscar loja"
            className="h-10 rounded-lg border border-line-2 bg-surface px-3 text-sm focus:border-accent focus:outline-none md:ml-auto md:w-72"
          />
        </div>

        {stores.isPending && <Loading />}

        {forbidden && <p className="text-sm text-fg-2">Sem acesso.</p>}

        {stores.isError && !forbidden && <p className="text-sm text-danger-fg">Não foi possível carregar as lojas.</p>}

        {stores.isSuccess && visible.length === 0 && (
          <p className="text-sm text-fg-2">{all.length ? 'Nenhuma loja nesta aba.' : 'Nenhuma loja cadastrada.'}</p>
        )}

        {!!visible.length && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface md:rounded-xl">
            <div className={`hidden border-b border-line bg-hover px-4.5 py-2.5 text-xs text-muted ${COLUMNS}`}>
              <span>Loja</span>
              <span>Link</span>
              <span>Criada em</span>
              <span>Status</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {visible.map((store) => (
                <StoreRow key={store.id} store={store} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ active, className }: { active: boolean; className: string }) {
  return (
    <span
      className={`shrink-0 rounded-full font-medium ${active ? 'bg-ok-bg text-ok-fg' : 'bg-accepted-bg text-warn-fg'} ${className}`}
    >
      {active ? 'Ativa' : 'Pendente'}
    </span>
  );
}

function StoreRow({ store }: { store: AdminStoreRow }) {
  const setActive = useSetStoreActive();
  const createdAt = dateFormat.format(new Date(store.created_at));

  return (
    <li className={`flex items-center gap-2.5 p-3.5 md:items-center md:px-4.5 ${COLUMNS}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <Link
            to="/admin/$storeId"
            params={{ storeId: store.id }}
            className="truncate text-[15px] font-semibold text-fg hover:text-accent-fg hover:underline md:text-sm md:font-medium"
          >
            {store.name}
          </Link>
          <StatusChip active={store.active} className="px-1.75 py-px text-[11px] md:hidden" />
        </span>
        <span className="truncate text-xs text-muted md:hidden">
          {store.slug} · {createdAt}
        </span>
        <span className="flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{store.store_type === 'retail' ? 'Catálogo' : 'Cardápio'}</span>
          <span>{store.accepting_orders ? 'Aceitando pedidos' : 'Pedidos pausados'}</span>
          <span>
            Última msg: {store.last_message_at ? dateFormat.format(new Date(store.last_message_at)) : 'nenhuma'}
          </span>
          <span className={store.error_count24h ? 'font-medium text-danger-fg' : undefined}>
            Erros 24h: {store.error_count24h}
          </span>
          <span>Pedidos 30d: {store.orders30d.toLocaleString('pt-BR')}</span>
          <span>
            {store.router} · {store.llm_model}
          </span>
        </span>
      </div>
      <Link
        to="/$slug"
        params={{ slug: store.slug }}
        className="hidden truncate text-[13px] text-muted hover:text-accent-fg md:block"
      >
        /{store.slug}
      </Link>
      <span className="hidden text-[13px] text-fg-2 md:block">{createdAt}</span>
      <StatusChip active={store.active} className="hidden justify-self-start px-2 py-0.5 text-xs md:block" />
      <button
        type="button"
        disabled={setActive.isPending}
        onClick={() => setActive.mutate({ storeId: store.id, active: !store.active })}
        className={`h-10 shrink-0 justify-self-end rounded-lg border px-3 text-[13px] font-medium disabled:opacity-50 md:h-8 ${
          store.active
            ? 'border-line-2 bg-surface text-fg-2 hover:bg-hover'
            : 'border-accent bg-accent text-white hover:bg-accent-hover'
        }`}
      >
        {store.active ? 'Desativar' : 'Ativar'}
      </button>
    </li>
  );
}

/**
 * Creates a store already active, with its Clerk org; members come from `/admin/users`.
 */
function NewStore() {
  const create = useCreateAdminStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), ...(slug.trim() && { slug: slug.trim() }) },
      { onSuccess: ({ store }) => navigate({ to: '/admin/$storeId', params: { storeId: store.id } }) }
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 self-start rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        Nova loja
      </button>
    );
  }

  const error =
    create.error instanceof ApiError && create.error.field === 'slug'
      ? create.error.status === 409
        ? 'Endereço já usado.'
        : 'Endereço inválido ou reservado.'
      : create.isError
        ? 'Não foi possível criar a loja.'
        : null;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm md:flex-row md:items-end"
    >
      <label className="flex flex-1 flex-col gap-1.5 font-semibold">
        Nome
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 rounded-lg border border-line-2 px-3 font-normal"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1.5 font-semibold">
        Endereço (opcional)
        <input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="pizzaria-demo"
          className="h-11 rounded-lg border border-line-2 px-3 font-normal"
        />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-lg border border-line-2 px-4">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Criar loja
        </button>
      </div>
      {error && <p className="text-danger-fg md:basis-full">{error}</p>}
    </form>
  );
}
