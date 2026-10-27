import { useParams } from '@tanstack/react-router';

/**
 * Slug of the store in the panel URL (`/panel/$slug/...`); links inside the panel pass it on.
 */
export const usePanelSlug = () => useParams({ from: '/panel/$slug' }).slug;
