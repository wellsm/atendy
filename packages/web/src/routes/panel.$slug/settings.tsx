import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Old page, now a sheet of the panel page.
 */
export const Route = createFileRoute('/panel/$slug/settings')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/panel/$slug', params, search: { sheet: 'settings' }, replace: true });
  }
});
