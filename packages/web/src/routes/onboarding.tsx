import type { FormEvent } from 'react';

import { useAuth, useOrganizationList } from '@clerk/react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { useCreateStore, useMe } from '../lib/queries';

export const Route = createFileRoute('/onboarding')({
  /**
   * `new=1`: "+ Nova loja" from the panel; creates another store even when the user already has one.
   */
  validateSearch: (search: Record<string, unknown>): { new?: '1' } => ({
    ...(search.new === '1' && { new: '1' as const })
  }),
  component: () => (
    <SignedIn>
      <div className="min-h-screen bg-neutral-50 md:grid md:grid-cols-2">
        <Hero />
        <div className="relative -mt-4 rounded-t-2xl bg-neutral-50 px-5 py-6 md:mt-0 md:flex md:items-center md:justify-center md:rounded-none md:p-12">
          <Onboarding />
        </div>
      </div>
    </SignedIn>
  )
});

const STEPS = ['Cadastre a loja', 'Monte o cardápio', 'Conecte o WhatsApp'];

function Hero() {
  return (
    <div className="flex flex-col gap-3 bg-red-600 px-6 pb-9 pt-5 text-white md:justify-between md:p-14">
      <p className="text-xs font-semibold uppercase tracking-wider md:text-sm">Atendy</p>
      <div className="flex max-w-md flex-col gap-4">
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-balance md:text-4xl">
          Seu delivery atendido no WhatsApp<span className="hidden md:inline">, 24 horas por dia</span>.
        </h2>
        <p className="hidden text-base leading-normal md:block">
          O bot anota o pedido com o seu cardápio e as suas regras. Você aceita e despacha pelo painel.
        </p>
      </div>
      <ol className="hidden gap-7 text-sm md:flex">
        {STEPS.map((step, index) => (
          <li key={step} className="flex flex-col gap-0.5">
            <b className="text-base">{index + 1}</b>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Onboarding() {
  const newStore = Route.useSearch().new === '1';
  const { orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const memberOrgId = userMemberships.data?.[0]?.organization.id;

  // One Clerk Organization = one store. A session without an active org reuses the user's org when there is one;
  // otherwise the store form creates it (see useCreateStore).
  useEffect(() => {
    if (!newStore && !orgId && memberOrgId) {
      void setActive?.({ organization: memberOrgId });
    }
  }, [newStore, orgId, memberOrgId, setActive]);

  if (!newStore && !orgId && (!isLoaded || userMemberships.isLoading || memberOrgId)) {
    return <Loading />;
  }

  return <StoreForm newStore={newStore} />;
}

function StoreForm({ newStore }: { newStore: boolean }) {
  const me = useMe();
  const createStore = useCreateStore({ newOrg: newStore });
  const [name, setName] = useState('');
  const [acceptRisk, setAcceptRisk] = useState(false);

  if (me.isPending) {
    return <Loading />;
  }

  // A new store is done when the request succeeds; before that, `me` still shows the current store.
  if (newStore ? createStore.isSuccess : me.data?.store) {
    return <Navigate to="/panel" />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    createStore.mutate({ name: name.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-5 md:max-w-md">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {newStore ? 'Nova loja' : 'Cadastre sua loja'}
        </h1>
        <p className="text-sm text-neutral-500">Leva um minuto. Você ajusta o resto depois.</p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="store-name">
        Nome da loja
        <input
          id="store-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={80}
          required
          className="rounded-lg border border-neutral-300 bg-white px-3.5 py-3 text-base font-normal focus:border-red-500 focus:outline-none md:text-[15px]"
          placeholder="Pizzaria do Bairro"
        />
      </label>

      <div className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Aviso sobre o WhatsApp</p>
        <p className="leading-normal">
          O Atendy conecta ao WhatsApp por uma integração não oficial. O WhatsApp pode banir o número a qualquer
          momento. Use um número dedicado à loja.
        </p>
        <label className="flex cursor-pointer items-center gap-2.5 py-1.5 md:py-0.5">
          <input
            type="checkbox"
            checked={acceptRisk}
            onChange={(event) => setAcceptRisk(event.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="flex size-5.5 shrink-0 items-center justify-center rounded-md border-2 border-amber-600 bg-white text-xs font-bold text-white peer-checked:border-red-600 peer-checked:bg-red-600 peer-focus-visible:ring-2 peer-focus-visible:ring-red-500 peer-focus-visible:ring-offset-2 md:size-5"
          >
            {acceptRisk && '✓'}
          </span>
          <span>Entendo e aceito esse risco.</span>
        </label>
      </div>

      {createStore.isError && (
        <p className="text-sm text-red-700">Não foi possível cadastrar a loja. Tente novamente.</p>
      )}

      <button
        type="submit"
        disabled={!acceptRisk || name.trim().length < 2 || createStore.isPending}
        className="h-13 rounded-xl bg-red-600 text-base font-semibold text-white enabled:hover:bg-red-700 disabled:opacity-50 md:h-12 md:rounded-lg md:text-[15px]"
      >
        {createStore.isPending ? 'Cadastrando…' : 'Cadastrar loja'}
      </button>
    </form>
  );
}
