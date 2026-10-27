import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Old page, now a sheet of the panel page.
 */
export const Route = createFileRoute('/panel/$slug/menu/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/panel/$slug', params, search: { sheet: 'menu' }, replace: true });
  }
});
