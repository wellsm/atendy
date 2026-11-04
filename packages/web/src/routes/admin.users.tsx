import type { FormEvent } from 'react';
import type { AdminUser } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { ApiError } from '../lib/api';
import { useAdminStores, useAdminUsers, useDeleteAdminUser, useSaveAdminUser } from '../lib/queries';

export const Route = createFileRoute('/admin/users')({
  component: () => (
    <SignedIn>
      <AdminUsers />
    </SignedIn>
  )
});

/**
 * Clerk logins and the stores each one belongs to (one user may see many stores).
 */
function AdminUsers() {
  const users = useAdminUsers();
  // `null`: closed; `'new'`: create form; a user: edit its stores.
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const forbidden = users.error instanceof ApiError && users.error.status === 403;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6 md:px-8">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link to="/admin" className="text-sm text-neutral-500">
              ← Lojas
            </Link>
            <h1 className="text-xl font-semibold">Usuários</h1>
          </div>
          <div className="flex items-center gap-3">
            {editing === null && (
              <button
                type="button"
                onClick={() => setEditing('new')}
                className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Novo usuário
              </button>
            )}
            <UserButton />
          </div>
        </header>

        {editing !== null && (
          <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing} onDone={() => setEditing(null)} />
        )}

        {users.isPending && <Loading />}
        {forbidden && <p className="text-sm text-neutral-600">Sem acesso.</p>}
        {users.isError && !forbidden && <p className="text-sm text-red-700">Não foi possível carregar os usuários.</p>}
        {users.isSuccess && !users.data.users.length && (
          <p className="text-sm text-neutral-600">Nenhum usuário cadastrado.</p>
        )}

        {!!users.data?.users.length && (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">E-mail</th>
                  <th className="px-4 py-2.5 font-medium">Lojas</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((user) => (
                  <tr key={user.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">{user.email}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {user.stores.map(({ name }) => name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(user)}
                        className="h-9 rounded-lg border border-neutral-300 px-3 hover:bg-neutral-50"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UserForm({ user, onDone }: { user: AdminUser | 'new'; onDone: () => void }) {
  const stores = useAdminStores();
  const save = useSaveAdminUser();
  const remove = useDeleteAdminUser();
  const existing = user === 'new' ? undefined : user;
  const [email, setEmail] = useState(existing?.email ?? '');
  const [storeIds, setStoreIds] = useState<string[]>(existing?.stores.map(({ id }) => id) ?? []);
  const [confirming, setConfirming] = useState(false);

  const toggle = (id: string) =>
    setStoreIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ userId: existing?.id, email: email.trim(), storeIds }, { onSuccess: onDone });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-dashed border-neutral-400 bg-white p-4 text-sm"
    >
      <label className="flex flex-col gap-1.5 font-semibold">
        E-mail
        <input
          type="email"
          required
          value={email}
          disabled={!!existing}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="maria+clerk_test@exemplo.com"
          className="h-11 rounded-lg border border-neutral-300 px-3 font-normal disabled:bg-neutral-50"
        />
        <span className="text-xs font-normal text-neutral-500">
          Final +clerk_test: entra sempre com o código 424242.
        </span>
      </label>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1.5 font-semibold">Lojas</legend>
        {stores.data?.stores.map((store) => (
          <label key={store.id} className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={storeIds.includes(store.id)} onChange={() => toggle(store.id)} />
            {store.name}
          </label>
        ))}
      </fieldset>

      {save.isError && (
        <p className="text-red-700">
          {save.error instanceof ApiError && save.error.field === 'store_ids'
            ? 'Alguma loja marcada não tem organização no Clerk.'
            : 'Não foi possível salvar.'}
        </p>
      )}
      {remove.isError && <p className="text-red-700">Não foi possível excluir.</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {existing &&
          (confirming ? (
            <>
              <span className="mr-auto text-neutral-600">Excluir {existing.email}? As lojas continuam.</span>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-11 rounded-lg border border-neutral-300 px-4"
              >
                Não
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(existing.id, { onSuccess: onDone })}
                className="h-11 rounded-lg bg-red-600 px-4 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Excluir
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mr-auto h-11 px-2 text-red-700 hover:underline"
            >
              Excluir usuário
            </button>
          ))}
        {!confirming && (
          <>
            <button type="button" onClick={onDone} className="h-11 rounded-lg border border-neutral-300 px-4">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Salvar
            </button>
          </>
        )}
      </div>
    </form>
  );
}
