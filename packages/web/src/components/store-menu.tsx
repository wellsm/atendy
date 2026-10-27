import { useAuth, useOrganizationList } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useMyStores } from '../lib/queries';

const ITEM = 'flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2';

/**
 * Store name with the user's other stores (one Clerk Organization each) and "+ Nova loja". A store opens by its
 * slug (the panel layout activates its org); an org without a store yet goes back to onboarding.
 */
export function StoreMenu({ name }: { name: string }) {
  const { orgId } = useAuth();
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: { pageSize: 50 } });
  const stores = useMyStores();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const finishOnboarding = async (organization: string) => {
    setOpen(false);

    if (!setActive) {
      return;
    }

    setSwitching(true);

    try {
      await setActive({ organization });
      // Nothing of the previous store may show under the new one.
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({ to: '/onboarding' });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={switching}
        onClick={() => setOpen(!open)}
        className="flex max-w-full items-center gap-1 font-semibold disabled:opacity-60"
      >
        <span className="truncate">{switching ? 'Trocando…' : name}</span>
        <span className="text-xs text-muted">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-2 w-64 rounded-lg border border-line bg-surface py-1 text-sm shadow-lg"
        >
          {userMemberships.data?.map(({ organization }) => {
            const store = stores.data?.find((item) => item.org_id === organization.id);
            const label = (
              <>
                <span className="truncate">{store?.name ?? organization.name}</span>
                {organization.id === orgId && <span className="text-accent-fg">✓</span>}
              </>
            );

            return store ? (
              <Link
                key={organization.id}
                to="/panel/$slug"
                params={{ slug: store.slug }}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={ITEM}
              >
                {label}
              </Link>
            ) : (
              <button
                key={organization.id}
                type="button"
                role="menuitem"
                onClick={() => void finishOnboarding(organization.id)}
                className={ITEM}
              >
                {label}
              </button>
            );
          })}
          <div className="my-1 border-t border-line" />
          <Link
            to="/onboarding"
            search={{ new: '1' }}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 font-medium text-accent-fg hover:bg-surface-2"
          >
            + Nova loja
          </Link>
        </div>
      )}
    </div>
  );
}
