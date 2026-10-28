import type { PanelConversation, PanelOrder } from '../lib/queries';

import { useState } from 'react';

import { customerInitials, customerName } from './conversations/customer';
import { STATUS_CHIP } from './conversations/order-panel';
import { formatMoney, formatPhone, formatWhen, handoffLabel, orderCustomerName, STATUS_LABEL } from '../lib/format';
import { usePanelNavigate } from '../lib/panel-search';

const normalize = (text: string | null | undefined) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const place = (order: PanelOrder) =>
  order.fulfillment === 'delivery'
    ? [order.address, order.neighborhood].filter(Boolean).join(' · ')
    : 'Retirada na loja';

/**
 * Finds orders (code, customer, address, neighborhood, phone) and customers (name, phone) among what the panel has
 * loaded; picking one opens its conversation.
 */
export function GlobalSearch({ conversations, orders }: { conversations: PanelConversation[]; orders: PanelOrder[] }) {
  const navigate = usePanelNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const search = normalize(query.trim()).replace(/^#/, '');
  const digits = query.replace(/\D/g, '');
  const phoneMatch = (phone: string | null) => digits.length >= 3 && !!phone?.includes(digits);

  const orderResults = search
    ? orders
        .filter(
          (order) =>
            normalize(order.code).startsWith(search) ||
            normalize(order.customer.name).includes(search) ||
            normalize(order.address).includes(search) ||
            normalize(order.neighborhood).includes(search) ||
            phoneMatch(order.customer.phone)
        )
        .slice(0, 6)
    : [];

  const customerResults = search
    ? conversations
        .filter(
          (conversation) =>
            normalize(conversation.customer.name).includes(search) || phoneMatch(conversation.customer.phone)
        )
        .slice(0, 4)
    : [];

  const first = orderResults[0]?.conversation_id ?? customerResults[0]?.id;

  // Counter sales have no conversation to open.
  const pick = (conversationId: string | null | undefined) => {
    setQuery('');
    setOpen(false);

    if (conversationId) {
      void navigate({ c: conversationId });
    }
  };

  return (
    <div className="relative min-w-0 flex-1 md:max-w-[640px]">
      <label
        className={`flex h-10 items-center gap-2.5 rounded-[10px] border bg-surface-2 pl-3.5 pr-3 ${open ? 'border-accent' : 'border-line'}`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="shrink-0 text-muted"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // The open sheet must not close too.
              event.preventDefault();
              setQuery('');
              event.currentTarget.blur();
            }

            if (event.key === 'Enter' && first) {
              pick(first);
            }
          }}
          placeholder="Buscar cliente, telefone, endereço ou nº do pedido"
          className="min-w-0 flex-1 bg-transparent text-base placeholder:text-muted focus:outline-none md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Limpar"
            onMouseDown={(event) => {
              event.preventDefault();
              setQuery('');
            }}
            className="p-1 text-[13px] text-muted"
          >
            ✕
          </button>
        )}
      </label>

      {open && search && (
        <div className="absolute inset-x-0 top-[46px] z-40 max-h-[480px] overflow-y-auto rounded-xl border border-line bg-surface py-1.5 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.35)]">
          {orderResults.length > 0 && (
            <>
              <span className="block px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Pedidos
              </span>
              {orderResults.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  // mousedown: the input's blur would close the list before a click lands.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(order.conversation_id);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-[9px] text-left hover:bg-hover"
                >
                  <span className="w-[52px] shrink-0 font-mono text-[13px] font-semibold text-fg-2">#{order.code}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{orderCustomerName(order)}</span>
                    <span className="truncate text-xs text-muted">
                      {place(order)} · {formatWhen(order.placed_at)}
                    </span>
                  </span>
                  <span
                    className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:block ${STATUS_CHIP[order.status]}`}
                  >
                    {STATUS_LABEL[order.status]}
                  </span>
                  <span className="w-[84px] shrink-0 text-right text-[13px] font-semibold">
                    {formatMoney(order.total_cents)}
                  </span>
                </button>
              ))}
            </>
          )}

          {customerResults.length > 0 && (
            <>
              <span className="block px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Clientes
              </span>
              {customerResults.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(conversation.id);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-[9px] text-left hover:bg-hover"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg-2">
                    {customerInitials(conversation)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{customerName(conversation)}</span>
                    <span className="truncate text-xs text-muted">
                      {formatPhone(conversation.customer.phone)} ·{' '}
                      {conversation.mode === 'human' ? handoffLabel(conversation.handoff_reason) : 'Bot atendendo'}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}

          {!orderResults.length && !customerResults.length && (
            <p className="p-3.5 text-sm text-muted">Nada encontrado para “{query.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  );
}
