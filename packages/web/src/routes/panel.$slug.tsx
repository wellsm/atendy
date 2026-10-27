import { useOrganizationList } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate, Outlet } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { Loading } from '../components/loading';
import { PanelShell } from '../components/panel-shell';
import { SignedIn } from '../components/signed-in';
import { useMe, useMyStores } from '../lib/queries';
import { RealtimeProvider } from '../lib/realtime';

export const Route = createFileRoute('/panel/$slug')({
  component: () => (
    <SignedIn>
      <Panel />
    </SignedIn>
  )
});

/**
 * The URL slug picks the store: when it is not the active org's store, the slug's org becomes the active one.
 */
function Panel() {
  const { slug } = Route.useParams();
  const me = useMe();
  const stores = useMyStores();
  const { setActive } = useOrganizationList();
  const queryClient = useQueryClient();
  const activating = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const current = me.data?.store?.slug === slug;
  const target = current ? undefined : stores.data?.find((store) => store.slug === slug);

  useEffect(() => {
    if (!target || !setActive || activating.current === target.org_id) {
      return;
    }

    activating.current = target.org_id;

    void (async () => {
      try {
        await setActive({ organization: target.org_id });
        // Nothing of the previous store may show under the new one.
        await queryClient.cancelQueries();
        queryClient.clear();
      } catch {
        setFailed(true);
      }
    })();
  }, [target, setActive, queryClient]);

  if (me.isPending) {
    return <Loading />;
  }

  if (me.isError || stores.isError) {
    return <p className="p-6 text-sm text-red-700">Não foi possível carregar sua loja. Recarregue a página.</p>;
  }

  if (current) {
    return (
      <RealtimeProvider slug={slug}>
        <PanelShell store={me.data.store!}>
          <Outlet />
        </PanelShell>
      </RealtimeProvider>
    );
  }

  if (!failed && (stores.isPending || target)) {
    return <Loading />;
  }

  if (!me.data.store) {
    return <Navigate to="/onboarding" />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-semibold">Loja não encontrada</p>
      <p className="text-sm text-neutral-600">Você não tem acesso a uma loja com este endereço.</p>
      <Link
        to="/panel/$slug"
        params={{ slug: me.data.store.slug }}
        className="text-sm font-medium text-red-700 hover:underline"
      >
        Ir para {me.data.store.name}
      </Link>
    </div>
  );
}
