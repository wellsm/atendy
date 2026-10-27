import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Old page: conversations are the panel page now.
 */
export const Route = createFileRoute('/panel/$slug/conversations')({
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    typeof search.c === 'string' ? { c: search.c } : {},
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/panel/$slug', params, search, replace: true });
  }
});
