import type { OrderStatus, PanelConversation, PanelOrder } from '../../lib/queries';

import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { customerInitials, customerName, needsPerson } from './customer';
import { STATUS_CHIP } from './order-panel';
import { formatMoney, formatWhen, handoffLabel, STATUS_LABEL } from '../../lib/format';
import { usePanelSlug } from '../../lib/panel-slug';

type Filter = 'all' | 'human' | Extract<OrderStatus, 'placed' | 'accepted' | 'out'>;

const STAGE_DOT: Record<Exclude<Filter, 'all'>, string> = {
  human: 'bg-accent',
  placed: 'bg-placed-fg',
  accepted: 'bg-accepted-fg',
  out: 'bg-out-fg'
};

const AUTHOR_PREFIX: Record<string, string> = { customer: '', bot: 'Bot: ', staff: 'Você: ' };

export function Avatar({ conversation, size }: { conversation: PanelConversation; size: 'sm' | 'md' }) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-fg-2 ${size === 'md' ? 'size-[42px] text-sm' : 'size-9 text-sm md:size-[38px]'}`}
    >
      {customerInitials(conversation)}
      {size === 'md' && needsPerson(conversation) && (
        <span className="absolute -right-px -top-px size-3 rounded-full border-2 border-surface bg-accent" />
      )}
    </span>
  );
}

/**
 * Conversations that need a person or have a new order first; the API order (latest message first) otherwise.
 * Filters by who handles it and by the stage of the open order.
 */
export function ConversationList({
  conversations,
  openOrders,
  selectedId
}: {
  conversations: PanelConversation[];
  openOrders: PanelOrder[];
  selectedId: string | undefined;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const orderOf = (conversation: PanelConversation) =>
    openOrders.find((order) => order.conversation_id === conversation.id);
  const urgent = (conversation: PanelConversation) =>
    needsPerson(conversation) || orderOf(conversation)?.status === 'placed';
  const stageCount = (status: OrderStatus) => openOrders.filter((order) => order.status === status).length;

  const list = conversations
    .filter((conversation) => {
      if (filter === 'all') {
        return true;
      }

      return filter === 'human' ? needsPerson(conversation) : orderOf(conversation)?.status === filter;
    })
    .sort((a, b) => Number(urgent(b)) - Number(urgent(a)));

  const filters: [Filter, string, number | undefined][] = [
    ['all', 'Todas', undefined],
    ['human', 'Precisam de você', conversations.filter(needsPerson).length],
    ['placed', 'Novos', stageCount('placed')],
    ['accepted', 'Em preparo', stageCount('accepted')],
    ['out', 'Saiu', stageCount('out')]
  ];

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold">Atendimento</h1>
          <span className="text-xs text-muted">
            {list.length} {list.length === 1 ? 'conversa' : 'conversas'}
          </span>
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          {filters.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-[11px] py-1.5 text-xs font-medium ${filter === value ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2'}`}
            >
              {value !== 'all' && <span className={`size-1.5 rounded-full ${STAGE_DOT[value]}`} />}
              {count === undefined ? label : `${label} · ${count}`}
            </button>
          ))}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {list.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            order={orderOf(conversation)}
            selected={conversation.id === selectedId}
          />
        ))}
        {list.length === 0 && (
          <li className="px-4 py-6 text-sm text-muted">
            {conversations.length === 0 ? 'Nenhuma conversa ainda.' : 'Nada por aqui agora.'}
          </li>
        )}
      </ul>
    </>
  );
}

function ConversationRow({
  conversation,
  order,
  selected
}: {
  conversation: PanelConversation;
  order: PanelOrder | undefined;
  selected: boolean;
}) {
  const slug = usePanelSlug();
  const human = needsPerson(conversation);
  const last = conversation.last_message;

  return (
    <li>
      <Link
        to="/panel/$slug"
        params={{ slug }}
        search={{ c: conversation.id }}
        className={`flex gap-3 border-b border-line px-4 py-3 ${selected ? 'bg-accent-soft' : 'hover:bg-hover'}`}
      >
        <Avatar conversation={conversation} size="md" />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex justify-between gap-2">
            <span className="truncate text-sm font-semibold">{customerName(conversation)}</span>
            <span className={`shrink-0 text-xs ${human ? 'text-accent-fg' : 'text-muted'}`}>
              {formatWhen(conversation.last_message_at)}
            </span>
          </span>
          {last && (
            <span className="truncate text-[13px] text-muted">
              {AUTHOR_PREFIX[last.author]}
              {last.body.split('\n')[0]}
            </span>
          )}
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {order && (
              <span className={`rounded-full px-[7px] py-px text-[11px] font-medium ${STATUS_CHIP[order.status]}`}>
                {STATUS_LABEL[order.status]} · {formatMoney(order.total_cents)}
              </span>
            )}
            {conversation.approval_reason ? (
              <span className="text-xs font-medium text-accent-fg">
                Aprovar: {handoffLabel(conversation.approval_reason)}
              </span>
            ) : human ? (
              <span className="text-xs font-medium text-accent-fg">{handoffLabel(conversation.handoff_reason)}</span>
            ) : (
              <span className="text-xs text-faint">Bot atendendo</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
