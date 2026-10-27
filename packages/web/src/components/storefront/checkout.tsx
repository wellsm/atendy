import type { ReactNode } from 'react';
import type { Cart } from '../../lib/cart';
import type { PaymentMethod, StorefrontStore } from '../../lib/storefront';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { PhoneCheck } from './phone-check';
import { ApiError, postPublic } from '../../lib/api';
import { centsToInput, formatMoney, maskPhoneInput, parseMoney } from '../../lib/format';
import { readPhoneToken, savePhoneToken } from '../../lib/phone-token';
import { PAYMENT_LABELS } from '../../lib/storefront';

type Quote = {
  subtotal_cents: number;
  fee_cents: number | null;
  total_cents: number | null;
  distance_km: number | null;
  delivery_error: 'location_needed' | 'out_of_area' | null;
  min_order_cents: number | null;
  below_minimum: boolean;
};

type Location = { latitude: number; longitude: number };

const ERROR_TEXT: Record<string, string> = {
  store_closed: 'A loja não está recebendo pedidos agora.',
  phone: 'Confira o telefone: DDD e número.',
  order_in_progress: 'Você já tem um pedido em andamento com a loja. Fale com ela pelo WhatsApp.',
  too_many: 'Muitos pedidos agora. Tente de novo em alguns minutos.',
  phone_unverified: 'Confirme seu WhatsApp com o código antes de enviar.',
  location_needed: 'Não achamos o endereço. Confira ou use sua localização.',
  delivery_area: 'Esse endereço está fora da área de entrega.',
  incomplete: 'Falta alguma informação do pedido.',
  product_inactive: 'Algum item ficou indisponível. Revise o carrinho.',
  unknown_product: 'Algum item ficou indisponível. Revise o carrinho.'
};

/**
 * Whether a cart line has the product or one of the options an `items` error named (options text from `optionsText`).
 */
const namedIn = (names: string[], line: { name: string; options: string }) =>
  names.includes(line.name) ||
  line.options
    .split('; ')
    .flatMap((group) => group.slice(group.indexOf(': ') + 2).split(' / '))
    .some((option) => names.includes(option));

const errorText = (error: unknown) =>
  // Something in the cart ran out: the API message names what, so the customer knows which line to remove.
  (error instanceof ApiError && error.field === 'items' && error.detail) ||
  (error instanceof ApiError && error.field && ERROR_TEXT[error.field]) ||
  'Não foi possível enviar o pedido. Tente de novo.';

const INPUT =
  'h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-[15px] focus:border-red-600 focus:outline-none md:text-sm';

/**
 * Value that settles `delay` ms after the last change (the quote waits for the customer to stop typing).
 */
const useSettled = <T,>(value: T, delay = 600) => {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
};

/**
 * ViaCEP fills street, bairro and city from a CEP (browser call; nothing goes through the API).
 */
const lookupCep = async (cep: string) => {
  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  const data = (await response.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string };

  return data.erro ? undefined : data;
};

/**
 * Cart review, delivery or pickup, address (CEP, GPS), contact, payment and the quoted total; sends the order for
 * the store to accept.
 */
export function Checkout(props: { store: StorefrontStore; slug: string; cart: Cart; onClose: () => void }) {
  const { store, cart } = props;
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [location, setLocation] = useState<Location>();
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneToken, setPhoneToken] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | undefined>(store.payment_methods[0]);
  const [change, setChange] = useState('');
  const [website, setWebsite] = useState('');
  const delivery = fulfillment === 'delivery';
  const byDistance = store.delivery_mode === 'by_distance';

  useEffect(() => {
    const digits = cep.replace(/\D/g, '');

    if (digits.length !== 8) {
      return;
    }

    void (async () => {
      try {
        const found = await lookupCep(digits);

        if (found) {
          setStreet(found.logradouro ?? '');
          setNeighborhood(found.bairro ?? '');
          setCity(found.localidade ?? '');
        }
      } catch {
        // ViaCEP down: the customer types the address.
      }
    })();
  }, [cep]);

  // A phone this browser already confirmed (any store) skips the code.
  useEffect(() => setPhoneToken(readPhoneToken(phone)), [phone]);

  const address = delivery
    ? [[street.trim(), number.trim()].filter(Boolean).join(', '), complement.trim(), city.trim()]
        .filter(Boolean)
        .join(' - ')
    : '';

  const items = cart.lines.map((line) => ({
    product_id: line.product_id,
    qty: line.qty,
    selections: line.selections,
    notes: line.notes
  }));

  const deliveryInput = {
    fulfillment,
    ...(delivery && {
      address: address || null,
      neighborhood: neighborhood.trim() || null,
      location: location ?? null
    })
  };

  // Distance delivery prices only with a location or a full address; by zone, with the bairro.
  const priceable =
    !delivery ||
    store.delivery_mode === 'flat' ||
    (store.delivery_mode === 'by_zone' ? !!neighborhood.trim() : !!location || (!!street.trim() && !!number.trim()));

  const request = useSettled(JSON.stringify({ items, delivery: deliveryInput }));

  const quote = useQuery({
    queryKey: ['quote', props.slug, request],
    queryFn: () => postPublic<Quote>(`/public/stores/${encodeURIComponent(props.slug)}/quote`, JSON.parse(request)),
    enabled: cart.lines.length > 0 && priceable,
    retry: false
  });

  const send = useMutation({
    mutationFn: (token: string | undefined) =>
      postPublic<{ code: string; total_cents: number }>(`/public/stores/${encodeURIComponent(props.slug)}/orders`, {
        name: name.trim(),
        phone,
        phone_token: token ?? null,
        items,
        delivery: deliveryInput,
        payment: {
          method,
          change_for_cents: method === 'cash' && change.trim() ? (parseMoney(change) ?? null) : null
        },
        website
      }),
    onSuccess: () => cart.clear(),
    onSettled: () => setConfirming(false),
    onError: (error) => {
      // Expired or signed with an old secret: ask the code again.
      if (error instanceof ApiError && error.field === 'phone_unverified') {
        savePhoneToken(phone, undefined);
        setPhoneToken(undefined);
      }
    }
  });

  const locate = () => {
    setLocating('busy');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocating('idle');
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  };

  const total = quote.data?.total_cents;

  const missing = [
    !cart.lines.length && 'itens',
    delivery && !street.trim() && 'rua',
    delivery && !number.trim() && 'número',
    delivery && store.delivery_mode === 'by_zone' && !neighborhood.trim() && 'bairro',
    !name.trim() && 'nome',
    phone.replace(/\D/g, '').length < 10 && 'telefone',
    !method && 'pagamento'
  ].filter(Boolean);

  const itemsError = [quote.error, send.error].find((error) => error instanceof ApiError && error.field === 'items') as
    ApiError | undefined;
  const soldOutNames = itemsError?.names ?? [];

  const blocked =
    !!missing.length || quote.data?.below_minimum || !!quote.data?.delivery_error || total == null || send.isPending;

  if (send.isSuccess) {
    return (
      <Shell title="Pedido enviado" onClose={props.onClose}>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">
            ✓
          </span>
          <p className="text-lg font-bold">Pedido #{send.data.code} enviado!</p>
          <p className="text-sm text-neutral-600">
            A loja vai conferir e confirmar pelo WhatsApp no número {phone}. Total {formatMoney(send.data.total_cents)}.
          </p>
          <button
            type="button"
            onClick={props.onClose}
            className="mt-3 h-11 rounded-lg bg-neutral-900 px-6 text-sm font-semibold text-white"
          >
            Voltar ao cardápio
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title="Seu pedido"
      onClose={props.onClose}
      footer={
        <div className="flex flex-col gap-2">
          {send.isError && <p className="text-sm text-red-700">{errorText(send.error)}</p>}
          {!!missing.length && cart.lines.length > 0 && (
            <p className="text-xs text-neutral-500">Falta: {missing.join(', ')}.</p>
          )}
          {confirming && !blocked ? (
            <PhoneCheck
              slug={props.slug}
              phone={phone}
              onToken={(token) => {
                setPhoneToken(token);
                send.mutate(token);
              }}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <button
              type="button"
              disabled={blocked}
              // The WhatsApp code is asked only here, with the order ready: browsing never pays for a code.
              onClick={() => (phoneToken ? send.mutate(phoneToken) : setConfirming(true))}
              className="h-12 rounded-lg bg-red-600 text-[15px] font-semibold text-white disabled:opacity-50"
            >
              {send.isPending ? 'Enviando…' : total != null ? `Enviar pedido · ${formatMoney(total)}` : 'Enviar pedido'}
            </button>
          )}
        </div>
      }
    >
      <Section title="Itens">
        {!cart.lines.length && <p className="text-sm text-neutral-500">O carrinho está vazio.</p>}
        <ul className="flex flex-col divide-y divide-neutral-100">
          {cart.lines.map((line) => (
            <li
              key={line.key}
              className={`flex items-center gap-3 py-3 ${namedIn(soldOutNames, line) ? '-mx-2 rounded-lg bg-red-50 px-2' : ''}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-medium">{line.name}</span>
                {line.options && <span className="text-xs text-neutral-500">{line.options}</span>}
                {line.notes && <span className="text-xs text-neutral-500">Obs.: {line.notes}</span>}
                <span className="text-sm font-semibold">{formatMoney(line.unit_cents * line.qty)}</span>
              </div>
              <div className="flex items-center rounded-lg border border-neutral-300">
                <button
                  type="button"
                  aria-label="Menos"
                  onClick={() => cart.setQty(line.key, line.qty - 1)}
                  className="size-9 text-neutral-600"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-semibold">{line.qty}</span>
                <button
                  type="button"
                  aria-label="Mais"
                  onClick={() => cart.setQty(line.key, Math.min(99, line.qty + 1))}
                  className="size-9 text-neutral-600"
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Como você quer receber?">
        <div className="grid grid-cols-2 gap-2">
          {(['delivery', 'pickup'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFulfillment(value)}
              className={`h-11 rounded-lg border text-sm font-medium ${fulfillment === value ? 'border-red-600 bg-red-50 text-red-700' : 'border-neutral-300 text-neutral-700'}`}
            >
              {value === 'delivery' ? 'Entrega' : 'Retirar na loja'}
            </button>
          ))}
        </div>

        {delivery && (
          <div className="mt-3 grid grid-cols-6 gap-2">
            <input
              value={cep}
              onChange={(event) => setCep(event.target.value)}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="CEP"
              className={`col-span-2 ${INPUT}`}
            />
            <input
              value={street}
              onChange={(event) => setStreet(event.target.value)}
              autoComplete="address-line1"
              placeholder="Rua"
              className={`col-span-4 ${INPUT}`}
            />
            <input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="Número"
              className={`col-span-2 ${INPUT}`}
            />
            <input
              value={complement}
              onChange={(event) => setComplement(event.target.value)}
              autoComplete="address-line2"
              placeholder="Complemento"
              className={`col-span-4 ${INPUT}`}
            />
            <input
              value={neighborhood}
              onChange={(event) => setNeighborhood(event.target.value)}
              placeholder="Bairro"
              className={`col-span-3 ${INPUT}`}
            />
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              autoComplete="address-level2"
              placeholder="Cidade"
              className={`col-span-3 ${INPUT}`}
            />
            {byDistance && (
              <button
                type="button"
                onClick={locate}
                disabled={locating === 'busy'}
                className="col-span-6 h-11 rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700 disabled:opacity-50"
              >
                {location
                  ? '✓ Localização usada para a taxa'
                  : locating === 'busy'
                    ? 'Localizando…'
                    : '📍 Usar minha localização'}
              </button>
            )}
            {locating === 'failed' && (
              <p className="col-span-6 text-xs text-neutral-500">
                Não foi possível pegar a localização. A taxa sai pelo endereço digitado.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title="Seus dados">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={80}
            placeholder="Nome"
            className={INPUT}
          />
          <input
            value={phone}
            onChange={(event) => setPhone(maskPhoneInput(event.target.value))}
            type="tel"
            inputMode="tel"
            maxLength={15}
            autoComplete="tel"
            placeholder="WhatsApp com DDD: (11) 98888-7777"
            className={INPUT}
          />
        </div>
        {phoneToken && <p className="text-xs font-medium text-green-700">✓ WhatsApp já confirmado neste aparelho</p>}
        {/* Only bots see and fill it. */}
        <input
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] size-px opacity-0"
        />
      </Section>

      <Section title="Pagamento na entrega ou retirada">
        <div className="flex flex-wrap gap-2">
          {store.payment_methods.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMethod(value)}
              className={`h-10 rounded-full border px-4 text-sm font-medium ${method === value ? 'border-red-600 bg-red-50 text-red-700' : 'border-neutral-300 text-neutral-700'}`}
            >
              {PAYMENT_LABELS[value]}
            </button>
          ))}
        </div>
        {method === 'cash' && (
          <input
            value={change}
            onChange={(event) => setChange(event.target.value)}
            onBlur={() => {
              const cents = parseMoney(change);

              if (cents != null) {
                setChange(centsToInput(cents));
              }
            }}
            inputMode="decimal"
            placeholder="Troco para quanto? (opcional)"
            className={`mt-2 ${INPUT}`}
          />
        )}
      </Section>

      <Section title="Total">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-600">Itens</dt>
            <dd>{formatMoney(quote.data?.subtotal_cents ?? cart.subtotalCents)}</dd>
          </div>
          {delivery && (
            <div className="flex justify-between">
              <dt className="text-neutral-600">
                Entrega{quote.data?.distance_km != null && ` (${quote.data.distance_km} km)`}
              </dt>
              <dd>
                {quote.data?.fee_cents != null
                  ? quote.data.fee_cents === 0
                    ? 'grátis'
                    : formatMoney(quote.data.fee_cents)
                  : quote.isFetching
                    ? 'calculando…'
                    : '—'}
              </dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <dt>Total</dt>
            <dd>{total != null ? formatMoney(total) : '—'}</dd>
          </div>
        </dl>
        {quote.data?.delivery_error === 'out_of_area' && (
          <p className="mt-2 text-sm text-red-700">Esse endereço está fora da área de entrega.</p>
        )}
        {quote.data?.delivery_error === 'location_needed' && (
          <p className="mt-2 text-sm text-red-700">
            Não achamos o endereço para calcular a entrega. Confira rua, número e cidade
            {byDistance ? ' ou use sua localização' : ''}.
          </p>
        )}
        {quote.data?.below_minimum && quote.data.min_order_cents != null && (
          <p className="mt-2 text-sm text-red-700">Pedido mínimo: {formatMoney(quote.data.min_order_cents)}.</p>
        )}
        {quote.isError && <p className="mt-2 text-sm text-red-700">{errorText(quote.error)}</p>}
      </Section>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-4 md:px-6">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Phone full screen, desktop right panel, like the product details.
 */
export function Shell(props: { title: string; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onClose();
    const overflow = document.body.style.overflow;

    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [props.onClose]);

  return (
    <div role="presentation" onClick={props.onClose} className="fixed inset-0 z-50 bg-white md:bg-neutral-900/55">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
        className="ml-auto flex h-full w-full flex-col bg-white md:max-w-lg md:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-3.5 md:px-6">
          <h2 className="flex-1 text-lg font-bold">{props.title}</h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Fechar"
            className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-600"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{props.children}</div>
        {props.footer && <div className="shrink-0 border-t border-neutral-200 px-4 py-3 md:px-6">{props.footer}</div>}
      </div>
    </div>
  );
}
