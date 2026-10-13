import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { PanelShell } from '../components/panel-shell';
import { SignedIn } from '../components/signed-in';
import { useMe } from '../lib/queries';

export const Route = createFileRoute('/_panel')({
  component: () => (
    <SignedIn>
      <Panel />
    </SignedIn>
  )
});

function Panel() {
  const me = useMe();

  if (me.isPending) {
    return <Loading />;
  }

  if (me.isError) {
    return <p className="p-6 text-sm text-red-700">Não foi possível carregar sua loja. Recarregue a página.</p>;
  }

  if (!me.data.store) {
    return <Navigate to="/onboarding" />;
  }

  return (
    <PanelShell store={me.data.store}>
      <Outlet />
    </PanelShell>
  );
}
