import type { MenuProduct, PendingImages, PendingLinks } from '../../lib/queries';

import { SheetHeader } from './sheet';
import { usePanelNavigate, usePanelSearch } from '../../lib/panel-search';
import {
  hasPendingImages,
  hasPendingLinks,
  useCreateProduct,
  useDeleteProduct,
  useMenu,
  useSaveMenuImages,
  useSaveStockLinks,
  useUpdateProduct
} from '../../lib/queries';
import { Loading } from '../loading';
import { ProductForm } from '../product-form';

/**
 * After the product is saved: its photos, then its stock links; `onError` runs when either fails.
 */
const useAfterSave = () => {
  const saveImages = useSaveMenuImages();
  const saveLinks = useSaveStockLinks();

  const run = (
    product: MenuProduct,
    pending: { images: PendingImages; links: PendingLinks },
    onDone: () => void,
    onError?: () => void
  ) => {
    const links = () =>
      hasPendingLinks(pending.links)
        ? saveLinks.mutate({ product, links: pending.links }, { onSuccess: onDone, onError })
        : onDone();

    if (hasPendingImages(pending.images)) {
      saveImages.mutate({ product, images: pending.images }, { onSuccess: links, onError });
    } else {
      links();
    }
  };

  // Every step that ran succeeded: the photos alone, or the photos and then the links.
  const isSuccess =
    !saveImages.isPending &&
    !saveImages.isError &&
    !saveLinks.isPending &&
    !saveLinks.isError &&
    (saveLinks.isSuccess || saveImages.isSuccess);

  return {
    run,
    isPending: saveImages.isPending || saveLinks.isPending,
    isSuccess,
    error: saveImages.error ?? saveLinks.error
  };
};

/**
 * A product's form inside the menu sheet: `productId` is `new` or the product's id.
 */
export function ProductEditor({ productId, onClose }: { productId: string; onClose: () => void }) {
  const navigate = usePanelNavigate();
  const back = () => void navigate({ sheet: 'menu' });
  const menu = useMenu();
  const isNew = productId === 'new';
  const categories = menu.data?.categories ?? [];
  const product = categories.flatMap(({ products }) => products).find(({ id }) => id === productId);

  return (
    <>
      <SheetHeader
        title={isNew ? 'Novo produto' : (product?.name ?? 'Editar produto')}
        subtitle="O bot usa o cardápio a partir da próxima mensagem do cliente."
        onBack={back}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
        {menu.isPending && <Loading />}

        {menu.isError && <p className="text-sm text-accent-fg">Não foi possível carregar o cardápio.</p>}

        {menu.data && isNew && <NewProduct onDone={back} />}

        {menu.data && !isNew && !product && (
          <p className="text-sm text-muted">
            Produto não encontrado.{' '}
            <button type="button" onClick={back} className="font-medium text-accent-fg">
              Voltar ao cardápio
            </button>
          </p>
        )}

        {product && <EditProduct product={product} onDone={back} />}
      </div>
    </>
  );
}

function NewProduct({ onDone }: { onDone: () => void }) {
  const navigate = usePanelNavigate();
  const { category } = usePanelSearch();
  const menu = useMenu();
  const create = useCreateProduct();
  const after = useAfterSave();
  const categories = menu.data?.categories ?? [];
  const categoryId = categories.find(({ id }) => id === category)?.id ?? categories[0]?.id;

  if (!categoryId) {
    return (
      <p className="text-sm text-muted">
        Crie uma categoria antes.{' '}
        <button type="button" onClick={onDone} className="font-medium text-accent-fg">
          Voltar ao cardápio
        </button>
      </p>
    );
  }

  return (
    <ProductForm
      categoryId={categoryId}
      categories={categories}
      saving={create.isPending || after.isPending}
      error={create.error}
      onCancel={onDone}
      onSave={(input, images, links) =>
        create.mutate(input, {
          onSuccess: ({ product }) =>
            // The product exists now: failed photos or links are retried on its edit form, never by creating it again.
            after.run(
              product,
              { images, links },
              onDone,
              () => void navigate({ sheet: 'menu', product: product.id, photo: 'failed' })
            )
        })
      }
    />
  );
}

function EditProduct({ product, onDone }: { product: MenuProduct; onDone: () => void }) {
  const { photo } = usePanelSearch();
  const menu = useMenu();
  const update = useUpdateProduct();
  const after = useAfterSave();
  const remove = useDeleteProduct();
  const categories = menu.data?.categories ?? [];

  return (
    <>
      {photo === 'failed' && !after.isSuccess && (
        <p className="mb-4 rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
          O produto foi criado, mas alguma foto ou vínculo de estoque não foi salvo. Confira e salve de novo.
        </p>
      )}

      <ProductForm
        product={product}
        categoryId={product.category_id}
        categories={categories}
        saving={update.isPending || after.isPending}
        error={update.error ?? after.error}
        onCancel={onDone}
        onSave={(input, images, links) =>
          update.mutate(
            { id: product.id, input },
            { onSuccess: ({ product: saved }) => after.run(saved, { images, links }, onDone) }
          )
        }
        onDelete={() => remove.mutate(product.id, { onSuccess: onDone })}
        deleting={remove.isPending}
        deleteError={remove.error}
      />
    </>
  );
}
