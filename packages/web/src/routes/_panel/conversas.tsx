import type { FormEvent } from 'react';
import type { PanelConversation, PanelMessage } from '../../lib/queries';

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { Loading } from '../../components/loading';
import { ApiError } from '../../lib/api';
import { formatPhone, formatWhen, handoffLabel } from '../../lib/format';
import { useConversation, useConversations, useSendMessage, useSetConversationMode } from '../../lib/queries';

export const Route = createFileRoute('/_panel/conversas')({
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    typeof search.c === 'string' ? { c: search.c } : {},
  component: Conversations
});

/**
 * Desktop: list and thread side by side. Phone: the list, or the thread when one is open (`?c=`).
 */
function Conversations() {
  const { c: selectedId } = Route.useSearch();
  const conversations = useConversations();

  return (
    <section className="md:grid md:h-[calc(100vh-4rem)] md:grid-cols-[18rem_1fr] md:gap-4">
      <div className={selectedId ? 'hidden md:block md:overflow-y-auto' : 'md:overflow-y-auto'}>
        <h1 className="text-xl font-semibold">Conversas</h1>

        <div className="mt-4">
          {conversations.isPending && <Loading />}

          {conversations.isError && <p className="text-sm text-red-700">Não foi possível carregar as conversas.</p>}

          {conversations.data?.conversations.length === 0 && (
            <p className="text-sm text-neutral-500">Nenhuma conversa ainda.</p>
          )}

          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {conversations.data?.conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
              />
            ))}
          </ul>
        </div>
      </div>

      {selectedId ? (
        <Thread key={selectedId} conversationId={selectedId} />
      ) : (
        <div className="hidden items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-500 md:flex">
          Escolha uma conversa.
        </div>
      )}
    </section>
  );
}

const customerName = (conversation: PanelConversation) =>
  conversation.customer.name ?? formatPhone(conversation.customer.phone);

function ConversationRow({ conversation, selected }: { conversation: PanelConversation; selected: boolean }) {
  return (
    <li>
      <Link
        to="/conversas"
        search={{ c: conversation.id }}
        className={`block px-4 py-3 ${selected ? 'bg-red-50' : 'hover:bg-neutral-50'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{customerName(conversation)}</p>
          <span className="shrink-0 text-xs text-neutral-500">{formatWhen(conversation.last_message_at)}</span>
        </div>
        {conversation.mode === 'human' ? (
          <p className="mt-1 truncate text-xs font-medium text-red-700">{handoffLabel(conversation.handoff_reason)}</p>
        ) : (
          <p className="mt-1 text-xs text-neutral-500">Bot atendendo</p>
        )}
      </Link>
    </li>
  );
}

const BUBBLE: Record<PanelMessage['author'], string> = {
  customer: 'self-start bg-white border border-neutral-200',
  bot: 'self-end bg-neutral-100',
  staff: 'self-end bg-red-50 border border-red-100'
};

const AUTHOR_LABEL: Record<PanelMessage['author'], string> = {
  customer: 'Cliente',
  bot: 'Bot',
  staff: 'Loja'
};

function Thread({ conversationId }: { conversationId: string }) {
  const thread = useConversation(conversationId);
  const setMode = useSetConversationMode();
  const send = useSendMessage();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);
  const count = thread.data?.messages.length;

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [count]);

  if (thread.isPending) {
    return <Loading />;
  }

  if (thread.isError) {
    return (
      <p className="text-sm text-red-700">
        {thread.error instanceof ApiError && thread.error.status === 404
          ? 'Conversa não encontrada.'
          : 'Não foi possível carregar a conversa.'}
      </p>
    );
  }

  const { conversation, messages } = thread.data;
  const human = conversation.mode === 'human';

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
    <div className="flex min-h-[70vh] flex-col rounded-xl border border-neutral-200 bg-white md:min-h-0">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <Link to="/conversas" search={{}} className="text-sm text-neutral-600 md:hidden">
          ← Voltar
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{customerName(conversation)}</p>
          <p className="text-xs text-neutral-500">
            {formatPhone(conversation.customer.phone)} ·{' '}
            {human ? (
              <span className="text-red-700">{handoffLabel(conversation.handoff_reason)}</span>
            ) : (
              'Bot atendendo'
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={setMode.isPending}
          onClick={() => setMode.mutate({ conversationId, mode: human ? 'bot' : 'human' })}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {human ? 'Devolver ao bot' : 'Assumir'}
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <div key={message.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${BUBBLE[message.author]}`}>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
            <p className="mt-1 text-[11px] text-neutral-500">
              {AUTHOR_LABEL[message.author]} · {formatWhen(message.created_at)}
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-neutral-200 p-3">
        {!human && <p className="mb-2 text-xs text-neutral-500">Ao responder, você assume a conversa e o bot para.</p>}
        {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                onSubmit(event);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Escreva uma mensagem"
            className="min-w-0 flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={send.isPending || !text.trim()}
            className="self-end rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}
