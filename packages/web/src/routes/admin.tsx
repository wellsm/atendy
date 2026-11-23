import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AdminShell } from '../components/admin-shell';
import { SignedIn } from '../components/signed-in';

export const Route = createFileRoute('/admin')({
  component: () => (
    <SignedIn>
      <AdminShell>
        <Outlet />
      </AdminShell>
    </SignedIn>
  )
});
