import { createFileRoute } from '@tanstack/react-router';

import { PosScreen } from '../../components/pos/pos-screen';
import { useMe } from '../../lib/queries';

export const Route = createFileRoute('/panel/$slug/pos')({
  component: PosPage
});

/**
 * Full-screen counter sale, outside the panel shell (the panel route renders it only once the store is active here).
 */
function PosPage() {
  const store = useMe().data?.store;

  return store ? <PosScreen store={store} /> : null;
}
