import type { FormEvent } from 'react';

import { useAuth, useOrganizationList } from '@clerk/react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { useCreateStore, useMe } from '../lib/queries';

export const Route = createFileRoute('/onboarding')({
  component: () => (
    <SignedIn>
      <div className="flex min-h-screen items-center justify-center p-4">
        <Onboarding />
      </div>
    </SignedIn>
  )
});

function Onboarding() {
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const memberOrgId = userMemberships.data?.[0]?.organization.id;

  // One Clerk Organization = one store. A session without an active org reuses the user's org when there is one;
  // otherwise the store form creates it (see useCreateStore).
  useEffect(() => {
    if (!orgId && memberOrgId) {
      void setActive?.({ organization: memberOrgId });
    }
  }, [orgId, memberOrgId, setActive]);

  if (!orgId && (!isLoaded || userMemberships.isLoading || memberOrgId)) {
    return <Loading />;
  }

  return <StoreForm />;
}

function StoreForm() {
  const me = useMe();
  const createStore = useCreateStore();
  const [name, setName] = useState('');
  const [acceptRisk, setAcceptRisk] = useState(false);

  if (me.isPending) {
    return <Loading />;
  }

  if (me.data?.store) {
    return <Navigate to="/" />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    createStore.mutate({ name: name.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Cadastre sua loja</h1>

      <label className="mt-5 block text-sm font-medium" htmlFor="store-name">
        Nome da loja
      </label>
      <input
        id="store-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        minLength={2}
        maxLength={80}
        required
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
        placeholder="Pizzaria do Bairro"
      />

      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Aviso sobre o WhatsApp</p>
        <p className="mt-1">
          O Atendy conecta ao WhatsApp por uma integração não oficial. O WhatsApp pode banir o número a qualquer
          momento. Use um número dedicado à loja.
        </p>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={acceptRisk}
            onChange={(event) => setAcceptRisk(event.target.checked)}
            className="mt-0.5"
          />
          <span>Entendo e aceito esse risco.</span>
        </label>
      </div>

      {createStore.isError && (
        <p className="mt-4 text-sm text-red-700">Não foi possível cadastrar a loja. Tente novamente.</p>
      )}

      <button
        type="submit"
        disabled={!acceptRisk || name.trim().length < 2 || createStore.isPending}
        className="mt-5 w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {createStore.isPending ? 'Cadastrando…' : 'Cadastrar loja'}
      </button>
    </form>
  );
}
