import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { Loading } from '../../components/loading';
import { ProductForm } from '../../components/product-form';
import { useDeleteProduct, useMenu, useUpdateProduct } from '../../lib/queries';

export const Route = createFileRoute('/_panel/cardapio/$productId')({
  component: EditProductPage
});

function EditProductPage() {
  const { productId } = Route.useParams();
  const menu = useMenu();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const navigate = useNavigate();

  if (menu.isPending) {
    return <Loading />;
  }

  const categories = menu.data?.categories ?? [];
  const product = categories.flatMap(({ products }) => products).find(({ id }) => id === productId);
  const back = () => navigate({ to: '/cardapio' });

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Editar produto</h1>

      {menu.isError && <p className="mt-6 text-sm text-red-700">Não foi possível carregar o cardápio.</p>}

      {!menu.isError && !product && (
        <p className="mt-6 text-sm text-neutral-600">
          Produto não encontrado.{' '}
          <Link to="/cardapio" className="font-medium text-red-700">
            Voltar ao cardápio
          </Link>
        </p>
      )}

      {product && (
        <div className="mt-6">
          <ProductForm
            // A fresh form when another product opens in the same route.
            key={product.id}
            product={product}
            categoryId={product.category_id}
            categories={categories}
            saving={update.isPending}
            error={update.error}
            onSave={(input) => update.mutate({ id: product.id, input }, { onSuccess: back })}
            onDelete={() => remove.mutate(product.id, { onSuccess: back })}
            deleting={remove.isPending}
            deleteError={remove.error}
          />
        </div>
      )}
    </section>
  );
}
