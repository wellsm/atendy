import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { Loading } from '../../components/loading';
import { ProductForm } from '../../components/product-form';
import { useCreateProduct, useMenu } from '../../lib/queries';

export const Route = createFileRoute('/_panel/cardapio/novo')({
  validateSearch: (search: Record<string, unknown>): { categoria?: string } => ({
    ...(typeof search.categoria === 'string' && { categoria: search.categoria })
  }),
  component: NewProductPage
});

function NewProductPage() {
  const { categoria } = Route.useSearch();
  const menu = useMenu();
  const create = useCreateProduct();
  const navigate = useNavigate();

  if (menu.isPending) {
    return <Loading />;
  }

  const categories = menu.data?.categories ?? [];
  const categoryId = categories.find(({ id }) => id === categoria)?.id ?? categories[0]?.id;

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Novo produto</h1>

      {menu.isError && <p className="mt-6 text-sm text-red-700">Não foi possível carregar o cardápio.</p>}

      {!menu.isError && !categoryId && (
        <p className="mt-6 text-sm text-neutral-600">
          Crie uma categoria antes.{' '}
          <Link to="/cardapio" className="font-medium text-red-700">
            Voltar ao cardápio
          </Link>
        </p>
      )}

      {categoryId && (
        <div className="mt-6">
          <ProductForm
            categoryId={categoryId}
            categories={categories}
            saving={create.isPending}
            error={create.error}
            onSave={(input) => create.mutate(input, { onSuccess: () => navigate({ to: '/cardapio' }) })}
          />
        </div>
      )}
    </section>
  );
}
