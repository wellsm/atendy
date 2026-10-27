import type { DraftCart, DraftUpdate, MenuProduct, PaymentMethod } from '../../lib/queries';

import { useState } from 'react';

import { ApiError } from '../../lib/api';
import { centsToInput, formatMoney, parseMoney, PAYMENT_LABEL } from '../../lib/format';
import {
  useAddDraftItem,
  useDraft,
  useMenu,
  usePlaceDraft,
  useRemoveDraftItem,
  useSettings,
  useUpdateDraft
} from '../../lib/queries';
import { searchable } from '../../lib/storefront';
import { Loading } from '../loading';

const MISSING_LABEL: Record<string, string> = {
  items: 'itens',
  minimum_order: 'pedido mínimo',
  fulfillment: 'entrega ou retirada',
  address: 'endereço',
  location: 'localização do cliente',
  delivery_area: 'endereço fora da área de entrega',
  payment: 'pagamento'
};

const ERROR_TEXT: Record<string, string> = {
  location_needed: 'Endereço não encontrado. Peça a localização do WhatsApp ao cliente.',
  payment_not_accepted: 'A loja não aceita esse pagamento.',
  change_too_high: 'Troco acima do máximo da loja.',
  incomplete: 'Falta informação para fechar o pedido.',
  product_inactive: 'Produto ou opção pausado.',
  unknown_product: 'Produto não encontrado ou pausado.'
};

const errorText = (error: unknown) =>
  (error instanceof ApiError && error.field && ERROR_TEXT[error.field]) || 'Não foi possível salvar. Tente de novo.';

const MAX_RESULTS = 6;

const INPUT =
  'h-9 w-full rounded-lg border border-line-2 bg-surface px-2.5 text-[13px] focus:border-accent focus:outline-none';

/**
 * The attendant builds the conversation's order: items with options, delivery or pickup, payment, then places it.
 * Prices, fees and totals come from the API, like the bot's.
 */
export function OrderEditor({ conversationId }: { conversationId: string }) {
  const draft = useDraft(conversationId, true);
  const place = usePlaceDraft(conversationId);

  if (draft.isPending) {
    return <Loading />;
  }

  if (draft.isError) {
    return <p className="px-5 py-4 text-sm text-accent-fg">Não foi possível carregar o pedido.</p>;
  }

  const { cart, saved_address: saved } = draft.data;

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <span className="text-[15px] font-semibold">Montar pedido</span>

      <ProductSearch conversationId={conversationId} />

      {cart && cart.items.length > 0 && (
        <>
          <CartItems conversationId={conversationId} cart={cart} />
          <Fulfillment conversationId={conversationId} cart={cart} saved={saved} />
          <Payment conversationId={conversationId} cart={cart} />

          <dl className="space-y-1 border-t border-line pt-3 text-[13px]">
            {cart.fee_cents > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Taxa de entrega</dt>
                <dd>{formatMoney(cart.fee_cents)}</dd>
              </div>
            )}
            <div className="flex justify-between text-[15px] font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(cart.total_cents)}</dd>
            </div>
          </dl>

          {cart.missing.length > 0 && (
            <p className="text-xs text-muted">
              Falta: {cart.missing.map((missing) => MISSING_LABEL[missing] ?? missing).join(', ')}.
            </p>
          )}

          {place.isError && <p className="text-xs text-accent-fg">{errorText(place.error)}</p>}

          <button
            type="button"
            disabled={place.isPending || cart.missing.length > 0}
            onClick={() => place.mutate()}
            className="h-[42px] rounded-lg bg-accent text-sm font-semibold text-white disabled:opacity-50"
          >
            {place.isPending ? 'Fechando…' : 'Fechar pedido'}
          </button>
        </>
      )}
    </div>
  );
}

function ProductSearch({ conversationId }: { conversationId: string }) {
  const menu = useMenu();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<MenuProduct>();
  const search = searchable(query.trim());

  const products = (menu.data?.categories ?? [])
    .flatMap(({ products }) => products)
    .filter(({ active }) => active)
    .filter(({ name }) => !!search && searchable(name).includes(search))
    .slice(0, MAX_RESULTS);

  if (picked) {
    return <ProductPicker conversationId={conversationId} product={picked} onDone={() => setPicked(undefined)} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar produto para adicionar"
        className={INPUT}
      />
      {products.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => {
            setPicked(product);
            setQuery('');
          }}
          className="flex justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
        >
          <span className="truncate">{product.name}</span>
          <span className="shrink-0 text-muted">{formatMoney(product.price_cents)}</span>
        </button>
      ))}
      {!!search && !products.length && menu.data && <span className="px-1 text-xs text-muted">Nada encontrado.</span>}
    </div>
  );
}

/**
 * Options of one product (each group within its min/max), quantity and notes.
 */
function ProductPicker(props: { conversationId: string; product: MenuProduct; onDone: () => void }) {
  const { product } = props;
  const add = useAddDraftItem(props.conversationId);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const groups = product.groups.map((group) => ({ ...group, options: group.options.filter(({ active }) => active) }));
  const short = groups.find((group) => (chosen[group.id]?.length ?? 0) < group.min);

  const toggle = (groupId: string, optionId: string, max: number) => {
    const current = chosen[groupId] ?? [];

    const next = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : max === 1
        ? [optionId]
        : current.length < max
          ? [...current, optionId]
          : current;

    setChosen({ ...chosen, [groupId]: next });
  };

  const submit = () =>
    add.mutate(
      {
        product_id: product.id,
        qty,
        selections: Object.entries(chosen)
          .filter(([, ids]) => ids.length)
          .map(([group_id, option_ids]) => ({ group_id, option_ids })),
        notes: notes.trim() || null
      },
      { onSuccess: props.onDone }
    );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{product.name}</span>
        <span className="text-[13px] text-muted">{formatMoney(product.price_cents)}</span>
      </div>

      {groups.map((group) => (
        <fieldset key={group.id} className="flex flex-col gap-1.5">
          <legend className="text-xs text-muted">
            {group.name} ·{' '}
            {group.min > 0
              ? `escolha ${group.min === group.max ? group.min : `${group.min} a ${group.max}`}`
              : 'opcional'}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {group.options.map((option) => {
              const on = chosen[group.id]?.includes(option.id) ?? false;

              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(group.id, option.id, group.max)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-accent bg-accent-soft text-accent-fg' : 'border-line-2 text-fg-2'}`}
                >
                  {option.name}
                  {option.price_delta_cents > 0 && ` +${formatMoney(option.price_delta_cents)}`}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line-2">
          <button
            type="button"
            aria-label="Menos"
            onClick={() => setQty(Math.max(1, qty - 1))}
            className="size-9 text-fg-2"
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-semibold">{qty}</span>
          <button type="button" aria-label="Mais" onClick={() => setQty(qty + 1)} className="size-9 text-fg-2">
            +
          </button>
        </div>
        <input
          value={notes}
          maxLength={200}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Observação"
          className={INPUT}
        />
      </div>

      {add.isError && <p className="text-xs text-accent-fg">{errorText(add.error)}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={add.isPending || !!short}
          title={short ? `Escolha em "${short.name}"` : undefined}
          onClick={submit}
          className="h-9 flex-1 rounded-lg bg-accent text-[13px] font-semibold text-white disabled:opacity-50"
        >
          Adicionar
        </button>
        <button type="button" onClick={props.onDone} className="h-9 px-2 text-[13px] text-muted">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function CartItems({ conversationId, cart }: { conversationId: string; cart: DraftCart }) {
  const remove = useRemoveDraftItem(conversationId);

  return (
    <ul className="space-y-2.5 border-t border-line pt-3 text-sm">
      {cart.items.map((item) => (
        <li key={item.item_id} className="flex justify-between gap-2">
          <div className="min-w-0">
            <p>
              <span className="font-semibold">{item.qty}x</span> {item.name}
            </p>
            {item.options && <p className="text-xs text-muted">{item.options}</p>}
            {item.notes && <p className="text-xs text-warn-fg">Obs.: {item.notes}</p>}
          </div>
          <span className="shrink-0 text-fg-2">{formatMoney(item.line_total_cents)}</span>
          <button
            type="button"
            aria-label={`Remover ${item.name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(item.item_id)}
            className="shrink-0 px-1 text-faint hover:text-accent-fg disabled:opacity-50"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

function Fulfillment(props: {
  conversationId: string;
  cart: DraftCart;
  saved: { address: string; neighborhood: string | null } | null;
}) {
  const { cart, saved } = props;
  const update = useUpdateDraft(props.conversationId);
  const [address, setAddress] = useState(cart.address ?? '');
  const [neighborhood, setNeighborhood] = useState(cart.neighborhood ?? '');
  const send = (input: DraftUpdate) => update.mutate(input);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="grid grid-cols-2 rounded-lg bg-seg p-[3px]">
        {(['delivery', 'pickup'] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={update.isPending}
            onClick={() => send({ fulfillment: value })}
            className={`h-8 rounded-md text-[13px] ${cart.fulfillment === value ? 'bg-seg-on font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted'}`}
          >
            {value === 'delivery' ? 'Entrega' : 'Retirada'}
          </button>
        ))}
      </div>

      {cart.fulfillment === 'delivery' && (
        <>
          {saved && saved.address !== cart.address && (
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => send({ use_saved_address: true })}
              className="rounded-lg border border-line-2 px-2.5 py-2 text-left text-xs text-fg-2 hover:bg-hover"
            >
              Usar endereço anterior: <b className="font-medium text-fg">{saved.address}</b>
              {saved.neighborhood && ` · ${saved.neighborhood}`}
            </button>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();

              if (address.trim()) {
                send({ address: { address: address.trim(), neighborhood: neighborhood.trim() || null } });
              }
            }}
            className="flex flex-col gap-1.5"
          >
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Rua, número, complemento"
              className={INPUT}
            />
            <div className="flex gap-1.5">
              <input
                value={neighborhood}
                onChange={(event) => setNeighborhood(event.target.value)}
                placeholder="Bairro"
                className={INPUT}
              />
              <button
                type="submit"
                disabled={update.isPending || !address.trim()}
                className="h-9 shrink-0 rounded-lg border border-line-2 px-3 text-[13px] font-medium disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </form>
          {cart.address && (
            <span className="text-xs text-muted">
              Entrega em {[cart.address, cart.neighborhood].filter(Boolean).join(' · ')}
              {cart.distance_km != null && ` (${cart.distance_km} km)`}
            </span>
          )}
        </>
      )}

      {update.isError && <p className="text-xs text-accent-fg">{errorText(update.error)}</p>}
    </div>
  );
}

function Payment({ conversationId, cart }: { conversationId: string; cart: DraftCart }) {
  const settings = useSettings();
  const update = useUpdateDraft(conversationId);
  const [change, setChange] = useState(cart.change_for_cents != null ? centsToInput(cart.change_for_cents) : '');
  const methods = settings.data?.payment_methods ?? [];

  const pay = (method: PaymentMethod, changeForCents: number | null = null) =>
    update.mutate({ payment: { method, change_for_cents: changeForCents } });

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs text-muted">Pagamento</span>
      <div className="flex flex-wrap gap-1.5">
        {methods.map((method) => (
          <button
            key={method}
            type="button"
            disabled={update.isPending}
            onClick={() => pay(method)}
            className={`rounded-full border px-3 py-1 text-[13px] ${cart.payment_method === method ? 'border-accent bg-accent-soft text-accent-fg' : 'border-line-2 text-fg-2'}`}
          >
            {PAYMENT_LABEL[method]}
          </button>
        ))}
      </div>

      {cart.payment_method === 'cash' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            pay('cash', change.trim() ? (parseMoney(change) ?? null) : null);
          }}
          className="flex gap-1.5"
        >
          <input
            value={change}
            inputMode="decimal"
            onChange={(event) => setChange(event.target.value)}
            placeholder="Troco para (R$)"
            className={INPUT}
          />
          <button
            type="submit"
            disabled={update.isPending}
            className="h-9 shrink-0 rounded-lg border border-line-2 px-3 text-[13px] font-medium disabled:opacity-50"
          >
            Salvar
          </button>
        </form>
      )}

      {update.isError && <p className="text-xs text-accent-fg">{errorText(update.error)}</p>}
    </div>
  );
}
