import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Old page (`new` included), now the product form inside the panel's menu sheet.
 */
export const Route = createFileRoute('/panel/$slug/menu/$productId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/panel/$slug',
      params: { slug: params.slug },
      search: { sheet: 'menu', product: params.productId },
      replace: true
    });
  }
});
