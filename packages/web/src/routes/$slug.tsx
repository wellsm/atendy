import type { ReactNode } from 'react';
import type { StorefrontCategory, StorefrontProduct, StorefrontStore } from '../lib/storefront';

import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Loading } from '../components/loading';
import { Checkout } from '../components/storefront/checkout';
import { MyOrders } from '../components/storefront/my-orders';
import { ProductDetails } from '../components/storefront/product-details';
import { ApiError } from '../lib/api';
import { useCart } from '../lib/cart';
import { formatMoney } from '../lib/format';
import { startingPrice, unavailableGroups } from '../lib/menu';
import { latestPhoneToken } from '../lib/phone-token';
import { initials, PAYMENT_LABELS, searchable, useStorefront } from '../lib/storefront';

export const Route = createFileRoute('/$slug')({
  component: StorefrontPage
});

/**
 * Public menu of a store (`/<slug>`). While the store takes orders, products go to a cart kept in the browser and the
 * checkout sends the order for the store to accept.
 */
function StorefrontPage() {
  const { slug } = Route.useParams();
  const storefront = useStorefront(slug);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>();
  const [selected, setSelected] = useState<StorefrontProduct>();
  const [checkout, setCheckout] = useState(false);
  const [history, setHistory] = useState(false);
  // The phone this browser confirmed with the WhatsApp code: it opens "Meus pedidos" (read again after a checkout).
  const [account, setAccount] = useState<{ phone: string; token: string }>();
  const cart = useCart(slug);

  useEffect(() => {
    if (!checkout) {
      setAccount(latestPhoneToken());
    }
  }, [checkout]);

  const name = storefront.data?.store.name;

  useEffect(() => {
    if (name) {
      document.title = `${name} · Cardápio`;
    }
  }, [name]);

  if (storefront.isPending) {
    return <Loading />;
  }

  if (storefront.isError) {
    const notFound = storefront.error instanceof ApiError && storefront.error.status === 404;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-50 p-6 text-center">
        <p className="font-semibold">{notFound ? 'Loja não encontrada' : 'Não foi possível carregar o cardápio'}</p>
        <p className="text-sm text-neutral-600">
          {notFound ? 'Confira o endereço com a loja.' : 'Recarregue a página em alguns instantes.'}
        </p>
      </div>
    );
  }

  const { store } = storefront.data;
  const term = searchable(query.trim());
  const categories = storefront.data.categories
    .map((category) => ({
      ...category,
      products: category.products.filter(
        ({ name, description }) => !term || searchable(`${name} ${description ?? ''}`).includes(term)
      )
    }))
    .filter(({ products }) => products.length);

  const goTo = (categoryId: string) => {
    setActiveCategory(categoryId);
    document.getElementById(`category-${categoryId}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const current = activeCategory ?? categories[0]?.id;
  const search = <SearchInput value={query} onChange={setQuery} />;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-20 hidden border-b border-neutral-200 bg-white md:block">
        <div className="mx-auto flex max-w-292 items-center gap-6 px-6 py-3">
          <div className="flex min-w-55 items-center gap-2.5">
            <Avatar name={store.name} className="size-9 text-sm" />
            <span className="text-[15px] font-semibold">{store.name}</span>
          </div>
          <div className="max-w-130 flex-1">{search}</div>
          {account && <MyOrdersButton onClick={() => setHistory(true)} />}
        </div>
      </header>

      <StoreHeader
        store={store}
        search={search}
        history={account && <MyOrdersButton onClick={() => setHistory(true)} />}
      />

      <nav className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-neutral-200 bg-white px-4 py-2.5 [scrollbar-width:none] md:top-16.75 md:mt-6 md:bg-neutral-50 md:px-0 md:py-0">
        <div className="flex gap-2 md:mx-auto md:w-full md:max-w-292 md:gap-7 md:px-6">
          {categories.map((category) => (
            <CategoryTab
              key={category.id}
              category={category}
              active={category.id === current}
              onClick={() => goTo(category.id)}
            />
          ))}
        </div>
      </nav>

      <main className="mx-auto flex max-w-292 flex-col gap-2 pb-28 md:gap-9 md:px-6 md:pt-7">
        {!categories.length && (
          <p className="m-4 rounded-xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-600 md:m-0 md:p-8">
            {term ? `Nenhum produto encontrado para “${query.trim()}”.` : 'O cardápio ainda está vazio.'}
          </p>
        )}

        {categories.map((category) => (
          <section
            key={category.id}
            id={`category-${category.id}`}
            className="scroll-mt-16 bg-white md:flex md:scroll-mt-32 md:flex-col md:gap-3.5 md:bg-transparent"
          >
            <h2 className="px-4 pb-1.5 pt-4.5 text-lg font-bold md:p-0 md:text-xl">{category.name}</h2>
            <div className="md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3">
              {category.products.map((product) => (
                <ProductCard key={product.id} product={product} onOpen={() => setSelected(product)} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {selected && (
        <ProductDetails
          product={selected}
          onClose={() => setSelected(undefined)}
          onAdd={store.open ? cart.add : undefined}
        />
      )}

      {store.open && cart.count > 0 && !checkout && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => setCheckout(true)}
            className="mx-auto flex h-12 w-full max-w-lg items-center justify-between rounded-lg bg-red-600 px-4 text-[15px] font-semibold text-white"
          >
            <span>
              Ver pedido · {cart.count} {cart.count === 1 ? 'item' : 'itens'}
            </span>
            <span>{formatMoney(cart.subtotalCents)}</span>
          </button>
        </div>
      )}

      {checkout && <Checkout store={store} slug={slug} cart={cart} onClose={() => setCheckout(false)} />}

      {history && account && (
        <MyOrders
          slug={slug}
          phone={account.phone}
          token={account.token}
          open={store.open}
          products={storefront.data.categories.flatMap(({ products }) => products)}
          cart={cart}
          onCheckout={() => {
            setHistory(false);
            setCheckout(true);
          }}
          onClose={() => setHistory(false)}
        />
      )}
    </div>
  );
}

function Avatar({ name, className }: { name: string; className: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-red-600 font-bold text-white ${className}`}
    >
      {initials(name)}
    </span>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-11 items-center gap-2.5 rounded-[10px] bg-neutral-100 px-3.5 md:h-10.5">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        className="shrink-0 text-neutral-500"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar no cardápio"
        aria-label="Buscar no cardápio"
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none md:text-sm"
      />
    </label>
  );
}

function StatusPill({ store }: { store: StorefrontStore }) {
  if (!store.open) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600 md:text-sm">
        <span className="size-1.5 rounded-full bg-neutral-400 md:size-1.75" />
        Fechado agora
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800 md:text-sm">
      <span className="size-1.5 rounded-full bg-green-600 md:size-1.75" />
      {store.closes_at ? `Aberto · fecha às ${store.closes_at}` : 'Aberto'}
    </span>
  );
}

const deliveryText = (cents: number) => (cents === 0 ? 'grátis' : `a partir de ${formatMoney(cents)}`);

/**
 * Phone: card over the page with the info grid and the search. Desktop: avatar, name and one info line.
 */
function MyOrdersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 shrink-0 rounded-full border border-neutral-300 bg-white px-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
    >
      Meus pedidos
    </button>
  );
}

function StoreHeader({ store, search, history }: { store: StorefrontStore; search: ReactNode; history?: ReactNode }) {
  const payments = store.payment_methods.map((method) => PAYMENT_LABELS[method]).join(' · ');
  const minOrder = store.min_order_cents ? formatMoney(store.min_order_cents) : null;
  const delivery = store.delivery_from_cents === null ? null : deliveryText(store.delivery_from_cents);

  return (
    <>
      <div className="flex flex-col gap-3 bg-white px-4 pb-4 pt-5 md:hidden">
        <div className="flex items-end gap-3">
          <Avatar name={store.name} className="size-18 text-[22px]" />
          <div className="mb-2">
            <StatusPill store={store} />
          </div>
          {history && <div className="mb-1.5 ml-auto">{history}</div>}
        </div>
        <h1 className="text-[22px] font-bold">{store.name}</h1>
        {(delivery || minOrder) && (
          <div className="grid grid-cols-2 rounded-xl border border-neutral-200 text-xs text-neutral-500">
            <div className="flex flex-col gap-0.5 border-r border-neutral-200 px-3 py-2.5">
              <span>Entrega</span>
              <b className="text-sm font-semibold text-neutral-900">{delivery ?? 'a combinar'}</b>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2.5">
              <span>Pedido mínimo</span>
              <b className="text-sm font-semibold text-neutral-900">{minOrder ?? 'sem mínimo'}</b>
            </div>
          </div>
        )}
        {payments && <p className="text-xs text-neutral-500">{payments}</p>}
        {search}
      </div>

      <div className="mx-auto mt-8 hidden max-w-292 items-center gap-5 px-6 md:flex">
        <Avatar name={store.name} className="size-20 text-[26px]" />
        <div className="flex flex-1 flex-col gap-2">
          <h1 className="text-[28px] font-bold tracking-tight">{store.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-neutral-600">
            <StatusPill store={store} />
            {delivery && (
              <span>
                Entrega <b className="font-semibold text-neutral-900">{delivery}</b>
              </span>
            )}
            {minOrder && (
              <span>
                Pedido mínimo <b className="font-semibold text-neutral-900">{minOrder}</b>
              </span>
            )}
            {payments && <span>{payments}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

function CategoryTab(props: { category: StorefrontCategory; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-current={props.active ? 'true' : undefined}
      className={`relative shrink-0 rounded-full px-3.5 py-2 text-sm md:rounded-none md:px-0 md:py-4 md:text-[15px] ${
        props.active
          ? 'bg-neutral-900 font-semibold text-white md:bg-transparent md:text-red-700'
          : 'bg-neutral-100 font-medium text-neutral-700 md:bg-transparent md:text-neutral-600'
      }`}
    >
      {props.category.name}
      {props.active && (
        <span className="absolute inset-x-0 -bottom-px hidden h-0.75 rounded-full bg-red-600 md:block" />
      )}
    </button>
  );
}

function ProductCard({ product, onOpen }: { product: StorefrontProduct; onOpen: () => void }) {
  const price = startingPrice(product);
  const short = unavailableGroups(product.groups);
  const unavailable = short.length > 0;
  const soldOutOnly = unavailable && short.every(({ soldOutOnly: stock }) => stock);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={unavailable || product.sold_out}
      className={`flex w-full gap-3.5 border-b border-neutral-100 bg-white px-4 py-3.5 text-left md:min-h-38 md:gap-4 md:rounded-xl md:border md:border-neutral-200 md:p-4 md:hover:border-neutral-300 md:hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] ${
        unavailable || product.sold_out ? 'opacity-55' : ''
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[15px] font-semibold md:text-base">{product.name}</span>
        {product.description && (
          <span className="line-clamp-2 text-[13px] leading-snug text-neutral-500 md:text-sm">
            {product.description}
          </span>
        )}
        <span className="mt-auto flex items-baseline gap-1.5 pt-0.5 text-[15px] md:text-base">
          {price.from && <span className="text-xs text-neutral-500 md:text-[13px]">a partir de</span>}
          <span className="font-semibold">{formatMoney(price.cents)}</span>
        </span>
        {product.sold_out || soldOutOnly ? (
          <span className="text-xs font-medium text-neutral-500">Esgotado</span>
        ) : (
          unavailable && <span className="text-xs font-medium text-amber-700">Indisponível no momento</span>
        )}
      </span>
      {product.image_url && (
        <img
          src={product.image_url}
          alt=""
          loading="lazy"
          className="size-24 shrink-0 rounded-[10px] bg-neutral-100 object-cover md:size-30"
        />
      )}
    </button>
  );
}
