import { createFileRoute, Navigate } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { useMe } from '../lib/queries';

export const Route = createFileRoute('/panel/')({
  component: () => (
    <SignedIn>
      <PanelHome />
    </SignedIn>
  )
});

/**
 * Sends the user to the active org's store, or to onboarding when it has none.
 */
function PanelHome() {
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

  return <Navigate to="/panel/$slug" params={{ slug: me.data.store.slug }} replace />;
}
