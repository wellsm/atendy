import type { FormEvent } from 'react';
import type { OrderMark, PanelMessage } from '../../lib/queries';

import { Link } from '@tanstack/react-router';
import { Fragment, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api';
import { formatMoney, formatPhone, handoffLabel, staffActed, STATUS_LABEL } from '../../lib/format';
import { usePanelSlug } from '../../lib/panel-slug';
import {
  useApproveConversation,
  useConversation,
  useOrders,
  useSendMessage,
  useSetConversationMode
} from '../../lib/queries';
import { Loading } from '../loading';
import { Avatar } from './conversation-list';
import { customerName } from './customer';
import { MessageBody } from './message-body';
import { Notice, OrderAside, OrderBar, STATUS_CHIP, useOrderStatus } from './order-panel';
import { QuickReplies } from './quick-replies';
import { STEP_LABEL } from '../sheets/dashboard-sheet';

const BUBBLE: Record<PanelMessage['author'], string> = {
  customer: 'self-start bg-bubble-in',
  bot: 'self-end bg-bubble-bot',
  staff: 'self-end bg-bubble-out'
};

const AUTHOR_LABEL: Record<PanelMessage['author'], { text: string; className: string } | undefined> = {
  customer: undefined,
  bot: { text: 'Bot', className: 'text-muted' },
  staff: { text: 'Loja', className: 'text-ok-fg' }
};

/**
 * Back to the bot only after someone at the store acted: took over, replied, or answered since the bot's last
 * message. Otherwise the bot would get back the same situation it handed off.
 */
const canReturnToBot = (handoffReason: string | null, messages: PanelMessage[]) => {
  if (staffActed(handoffReason)) {
    return true;
  }

  const lastBot = messages.findLastIndex(({ author }) => author === 'bot');

  return messages.slice(lastBot + 1).some(({ author }) => author === 'staff');
};

/**
 * Steps of a draft shown in the conversation (no order among them: the customer may give them in any order).
 */
const PROGRESS_STEPS = ['items', 'fulfillment', 'address', 'payment'] as const;

/**
 * Where an order happened in the thread: placed (its number and status) or abandoned.
 */
function OrderMarkBadge({ mark }: { mark: OrderMark }) {
  return (
    <span
      className={`my-1 self-center rounded-full px-3 py-1 text-xs font-medium shadow-[0_1px_1px_rgba(0,0,0,0.06)] ${STATUS_CHIP[mark.status]}`}
    >
      {mark.status === 'abandoned' ? 'Pedido abandonado' : `Pedido #${mark.code ?? ''} · ${STATUS_LABEL[mark.status]}`}{' '}
      · {formatMoney(mark.total_cents)}
    </span>
  );
}

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const dayLabel = (iso: string) => {
  const date = new Date(iso).toDateString();
  const yesterday = new Date();

  yesterday.setDate(yesterday.getDate() - 1);

  if (date === new Date().toDateString()) {
    return 'Hoje';
  }

  return date === yesterday.toDateString() ? 'Ontem' : day.format(new Date(iso));
};

/**
 * WhatsApp-style thread and, beside it on wide screens (above it, collapsible, otherwise), the conversation's open
 * order. The open order is the conversation's order in the "open" list; previous ones come from the "closed" list.
 */
export function Thread({ conversationId }: { conversationId: string }) {
  const slug = usePanelSlug();
  const thread = useConversation(conversationId);
  const openOrders = useOrders('open');
  const closedOrders = useOrders('closed');
  const setMode = useSetConversationMode();
  const approve = useApproveConversation();
  const send = useSendMessage();
  const controls = useOrderStatus(() => void thread.refetch());
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const count = thread.data?.messages.length;

  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [count]);

  if (thread.isPending) {
    return <Loading />;
  }

  if (thread.isError) {
    return (
      <p className="p-4 text-sm text-accent-fg">
        {thread.error instanceof ApiError && thread.error.status === 404
          ? 'Conversa não encontrada.'
          : 'Não foi possível carregar a conversa.'}
      </p>
    );
  }

  const { conversation, messages, orders: marks, progress } = thread.data;

  // Each order mark goes after the last message sent up to its time (before the first message when older).
  const marksAfter = (index: number) =>
    marks.filter(
      ({ at }) =>
        (index < 0 || at >= messages[index]!.created_at) &&
        (index + 1 >= messages.length || at < messages[index + 1]!.created_at)
    );
  const human = conversation.mode === 'human';
  const order = openOrders.data?.orders.find((open) => open.conversation_id === conversationId);
  const history = closedOrders.data?.orders.filter((closed) => closed.conversation_id === conversationId) ?? [];
  const approval = conversation.approval_reason;
  const status = approval
    ? 'Bot aguardando aprovação'
    : human
      ? handoffLabel(conversation.handoff_reason)
      : 'Bot atendendo';
  const returnable = !human || canReturnToBot(conversation.handoff_reason, messages);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();

    const body = text.trim();

    // Enter skips the disabled button: never send the same text twice while one send is in flight.
    if (!body || send.isPending) {
      return;
    }

    setError(undefined);

    send.mutate(
      { conversationId, text: body },
      {
        onSuccess: () => setText(''),
        onError: (failure) =>
          setError(
            failure instanceof ApiError && failure.status === 409
              ? 'O WhatsApp da loja não está conectado ou recusou a mensagem.'
              : 'Não foi possível enviar. Tente novamente.'
          )
      }
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 md:h-full">
      <div className="flex min-w-0 flex-1 flex-col bg-chat">
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface py-1.5 pl-1 pr-2.5 md:h-[60px] md:gap-3 md:px-4 md:py-0">
          <Link
            to="/panel/$slug"
            params={{ slug }}
            search={{}}
            aria-label="Voltar"
            className="flex h-11 w-10 shrink-0 items-center justify-center text-xl text-fg-2 md:hidden"
          >
            ←
          </Link>
          <Avatar conversation={conversation} size="sm" />
          <div className="flex min-w-0 flex-1 flex-col md:gap-0.5">
            <span className="truncate text-[15px] font-semibold">{customerName(conversation)}</span>
            <span className="truncate text-xs text-muted">
              <span className="hidden md:inline">{formatPhone(conversation.customer.phone)} · </span>
              <span className={human || approval ? 'text-accent-fg' : undefined}>{status}</span>
            </span>
          </div>
          <button
            type="button"
            disabled={setMode.isPending || !returnable}
            title={returnable ? undefined : 'Responda o cliente antes de devolver ao bot.'}
            onClick={() => setMode.mutate({ conversationId, mode: human ? 'bot' : 'human' })}
            className={`h-9 shrink-0 rounded-lg border px-3 text-[13px] font-medium disabled:opacity-50 md:px-3.5 ${human ? 'border-line-2 bg-surface text-fg-2' : 'border-accent bg-accent text-white'}`}
          >
            {human ? (
              <>
                Devolver<span className="hidden md:inline"> ao bot</span>
              </>
            ) : (
              <>
                Assumir<span className="hidden md:inline"> conversa</span>
              </>
            )}
          </button>
        </header>

        {human && (
          <p className="shrink-0 border-b border-accent-line bg-accent-soft px-4 py-2 text-[13px] leading-snug text-accent-fg">
            <b className="font-semibold">Você está atendendo.</b> {handoffLabel(conversation.handoff_reason)} — o bot
            está pausado nesta conversa.
          </p>
        )}

        {approval && (
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-warn-line bg-warn-bg px-4 py-3 text-[13px] leading-snug text-warn-fg md:flex-row md:items-center">
            <p className="flex-1">
              <b className="font-semibold">O bot pausou: {handoffLabel(approval)}.</b> Ele continua quando você aprovar,
              respondendo tudo o que o cliente mandou. O cliente não vê este aviso.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={approve.isPending || setMode.isPending}
                onClick={() => approve.mutate(conversationId)}
                className="h-9 flex-1 rounded-lg bg-accent px-3.5 font-semibold text-white disabled:opacity-50 md:flex-none"
              >
                Aprovar e continuar
              </button>
              <button
                type="button"
                disabled={approve.isPending || setMode.isPending}
                onClick={() => setMode.mutate({ conversationId, mode: 'human' })}
                className="h-9 rounded-lg border border-line-2 bg-surface px-3.5 font-medium text-fg-2 disabled:opacity-50"
              >
                Assumir
              </button>
            </div>
            {approve.isError && <span className="text-xs">Não foi possível aprovar. Tente novamente.</span>}
          </div>
        )}

        {progress && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2 text-xs">
            <span className="text-muted">Pedido em montagem:</span>
            {PROGRESS_STEPS.map((step) => (
              <span
                key={step}
                className={`rounded-full px-2 py-0.5 ${progress.includes(step) ? 'bg-ok-bg font-medium text-ok-fg' : 'bg-surface-2 text-faint'}`}
              >
                {progress.includes(step) && '✓ '}
                {STEP_LABEL[step]}
              </span>
            ))}
          </div>
        )}

        {order ? (
          <OrderBar order={order} controls={controls} />
        ) : (
          controls.notice && (
            <div className="shrink-0 border-b border-line bg-surface p-3 xl:hidden">
              <Notice text={controls.notice} />
            </div>
          )
        )}

        <div ref={scroller} className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3 md:px-10 md:py-4">
          {marksAfter(-1).map((mark) => (
            <OrderMarkBadge key={mark.id} mark={mark} />
          ))}
          {messages.map((message, index) => {
            const label = AUTHOR_LABEL[message.author];
            const today = dayLabel(message.created_at);
            const newDay = index === 0 || today !== dayLabel(messages[index - 1]!.created_at);

            return (
              <Fragment key={message.id}>
                {newDay && (
                  <span className="mb-1.5 self-center rounded-lg bg-surface px-2.5 py-1 text-xs text-muted shadow-[0_1px_1px_rgba(0,0,0,0.06)]">
                    {today}
                  </span>
                )}
                <div
                  className={`relative flex max-w-[84%] flex-col gap-0.5 rounded-[10px] px-2.5 pb-1 pt-1.5 shadow-[0_1px_1px_rgba(0,0,0,0.08)] md:max-w-[72%] ${message.reaction ? 'mb-3' : ''} ${BUBBLE[message.author]}`}
                >
                  {label && <span className={`text-[11px] font-semibold ${label.className}`}>{label.text}</span>}
                  <MessageBody body={message.body} audioUrl={message.audio_url} />
                  <span className="self-end text-[11px] text-muted">{time.format(new Date(message.created_at))}</span>
                  {message.reaction && (
                    <span
                      title="Reação do cliente"
                      className="absolute -bottom-3.5 left-2 rounded-full border border-line bg-surface px-1.5 text-sm leading-6 shadow-[0_1px_1px_rgba(0,0,0,0.08)]"
                    >
                      {message.reaction}
                    </span>
                  )}
                </div>
                {marksAfter(index).map((mark) => (
                  <OrderMarkBadge key={mark.id} mark={mark} />
                ))}
              </Fragment>
            );
          })}
        </div>

        <form
          onSubmit={onSubmit}
          className="flex shrink-0 flex-col gap-1.5 border-t border-line bg-surface px-2.5 pb-3 pt-2 md:px-4 md:pt-2.5"
        >
          <QuickReplies
            conversationId={conversationId}
            human={human}
            onPick={(reply) => setText((current) => (current.trim() ? `${current.trimEnd()}\n${reply}` : reply))}
          />
          {!human && (
            <span className="px-1.5 text-xs text-muted md:px-0">
              Ao responder, você assume a conversa e o bot para.
            </span>
          )}
          {error && <span className="px-1.5 text-xs text-accent-fg md:px-0">{error}</span>}
          <div className="flex items-end gap-2 md:gap-2.5">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  onSubmit(event);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Escreva uma mensagem"
              className="max-h-[120px] min-w-0 flex-1 resize-none rounded-[22px] border border-line bg-surface-2 px-4 py-3 text-base leading-snug [field-sizing:content] focus:outline-none md:py-[11px] md:text-sm"
            />
            <button
              type="submit"
              disabled={send.isPending || !text.trim()}
              aria-label="Enviar"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden>
                <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
              </svg>
            </button>
          </div>
        </form>
      </div>

      <OrderAside
        conversationId={conversationId}
        human={human}
        name={customerName(conversation)}
        phone={formatPhone(conversation.customer.phone)}
        order={order}
        history={history}
        controls={controls}
      />
    </div>
  );
}
