import type { AdminStore } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { createFileRoute } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { ApiError } from '../lib/api';
import { useAdminStores, useSetStoreActive } from '../lib/queries';

export const Route = createFileRoute('/admin')({
  component: () => (
    <SignedIn>
      <Admin />
    </SignedIn>
  )
});

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function Admin() {
  const stores = useAdminStores();
  const forbidden = stores.error instanceof ApiError && stores.error.status === 403;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin · Lojas</h1>
        <UserButton />
      </header>

      {stores.isPending && <Loading />}

      {forbidden && <p className="text-sm text-neutral-600">Sem acesso.</p>}

      {stores.isError && !forbidden && <p className="text-sm text-red-700">Não foi possível carregar as lojas.</p>}

      {stores.data?.stores.length === 0 && <p className="text-sm text-neutral-600">Nenhuma loja cadastrada.</p>}

      {!!stores.data?.stores.length && (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {stores.data.stores.map((store) => (
            <StoreRow key={store.id} store={store} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StoreRow({ store }: { store: AdminStore }) {
  const setActive = useSetStoreActive();

  return (
    <li className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{store.name}</p>
        <p className="truncate text-xs text-neutral-500">
          {store.slug} · criada em {dateFormat.format(new Date(store.created_at))}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={
            store.active
              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
              : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
          }
        >
          {store.active ? 'Ativa' : 'Pendente'}
        </span>
        <button
          type="button"
          disabled={setActive.isPending}
          onClick={() => setActive.mutate({ storeId: store.id, active: !store.active })}
          className={
            store.active
              ? 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50'
              : 'rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'
          }
        >
          {store.active ? 'Desativar' : 'Ativar'}
        </button>
      </div>
    </li>
  );
}
