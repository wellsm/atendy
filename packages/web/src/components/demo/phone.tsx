import type { FormEvent } from 'react';
import type { DemoSlot } from '../../lib/demo-phones';
import type { StoreLink } from '../../lib/queries';

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api';
import { useDemoThread, useSendDemoMessage } from '../../lib/queries';
import { MessageBody } from '../conversations/message-body';

const PHONE_FRAME = 'flex h-[640px] w-full max-w-[360px] rounded-[36px] bg-neutral-900 p-2.5 md:h-[720px]';

const storeName = (stores: StoreLink[], slug: string) => stores.find((store) => store.slug === slug)?.name ?? slug;

// Same body the webhook stores for a WhatsApp pin (API `formatLocationBody`), so the API reads it as one.
const locationBody = ({ latitude, longitude }: GeolocationCoordinates) =>
  `📍 Localização: ${latitude.toFixed(6)},${longitude.toFixed(6)}`;

const POPOVER_ITEM = 'px-3 py-2.5 text-left hover:bg-hover';

/**
 * Name + store of a fake customer: a new slot, or "Recomeçar conversa" (prefilled).
 */
export function SlotForm({
  stores,
  initial,
  onSave,
  onCancel
}: {
  stores: StoreLink[];
  initial: { name: string; slug: string };
  onSave: (input: { name: string; slug: string }) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim()) {
      onSave({ name: name.trim(), slug });
    }
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col justify-center gap-4 rounded-[28px] bg-surface p-7">
      <h2 className="text-xl font-semibold">Novo cliente</h2>
      <p className="text-sm text-muted">
        Dê um nome e escolha a loja. Ao salvar, este celular vira o WhatsApp desse cliente.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Nome
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="Ex.: Carla"
          className="h-11 rounded-[10px] border border-line-2 bg-surface px-3 text-[15px] w-full font-normal"
        />
      </label>
      {stores.length > 1 ? (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Loja
          <select
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className="h-11 w-full rounded-[10px] border border-line-2 bg-surface px-3 text-[15px] font-normal"
          >
            {stores.map((store) => (
              <option key={store.slug} value={store.slug}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="flex flex-col gap-1.5 text-sm font-semibold">
          Loja
          <span className="text-[15px] font-normal">{storeName(stores, slug)}</span>
        </p>
      )}
      <button
        type="submit"
        disabled={!name.trim()}
        className="h-12 rounded-[10px] bg-accent text-base font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
      >
        Salvar
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="h-11 text-sm text-muted hover:underline">
          Cancelar
        </button>
      )}
    </form>
  );
}

const threadError = (error: unknown) => {
  if (error instanceof ApiError && error.status === 404) {
    return 'Sem acesso a esta loja.';
  }

  if (error instanceof ApiError && error.status === 409) {
    return 'Loja inativa ou este número já é de um cliente real. Recomece a conversa.';
  }

  return 'Não foi possível carregar a conversa.';
};

/**
 * A fake customer's WhatsApp: the thread of its phone in the chosen store.
 */
export function DemoPhone({
  slot,
  stores,
  onChange,
  onRestart,
  onRemove
}: {
  slot: DemoSlot;
  stores: StoreLink[];
  onChange: (slot: DemoSlot) => void;
  onRestart: (input: { name: string; slug: string }) => void;
  onRemove: () => void;
}) {
  const [sentAt, setSentAt] = useState(0);
  const [text, setText] = useState('');
  const [popover, setPopover] = useState<'menu' | 'attach' | null>(null);
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [restarting, setRestarting] = useState(false);
  // Kept until the send succeeds, so a retry is the same message.
  const pendingId = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  const thread = useDemoThread(slot.slug, slot.phone, sentAt);
  const send = useSendDemoMessage();
  const messages = thread.data?.messages ?? [];
  const conversationId = thread.data?.conversation_id;

  // A restarted conversation (new phone) or another store is another message: never reuse a pending id.
  useEffect(() => {
    pendingId.current = undefined;
  }, [slot.slug, slot.phone]);

  // Scrolls the message list only, never the page (three phones side by side).
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length, thread.data?.typing]);

  // A click outside the open popover (or Esc) closes it.
  useEffect(() => {
    if (!popover) {
      return;
    }

    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) {
        setPopover(null);
      }
    };

    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);

    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [popover]);

  const deliver = async (body: string, clientMessageId: string) => {
    await send.mutateAsync({
      slug: slot.slug,
      phone: slot.phone,
      name: slot.name,
      text: body,
      client_message_id: clientMessageId
    });
    setSentAt(Date.now());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const body = text.trim();

    if (!body || send.isPending) {
      return;
    }

    pendingId.current ??= crypto.randomUUID();

    try {
      await deliver(body, pendingId.current);
      pendingId.current = undefined;
      setText('');
    } catch {
      // The error shows under the input; the same id goes again on retry.
    }
  };

  const shareLocation = () => {
    setPopover(null);

    if (!navigator.geolocation) {
      setLocating('failed');
      return;
    }

    setLocating('busy');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setLocating('idle');

        try {
          await deliver(locationBody(coords), crypto.randomUUID());
        } catch {
          // The error shows under the input; a new tap asks the position again (new message).
        }
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  };

  if (restarting) {
    return (
      <section aria-label={`Celular de ${slot.name}`} className={PHONE_FRAME}>
        <SlotForm
          stores={stores}
          initial={slot}
          onSave={(input) => {
            setRestarting(false);
            onRestart(input);
          }}
          onCancel={() => setRestarting(false)}
        />
      </section>
    );
  }

  return (
    <section ref={root} aria-label={`Celular de ${slot.name}`} className={PHONE_FRAME}>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-chat">
        <div className="flex flex-col gap-2 bg-[#075e54] px-3.5 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <div
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800"
            >
              {slot.name.charAt(0).toUpperCase()}
            </div>
            {stores.length > 1 ? (
              <label className="flex min-w-0 flex-1 flex-col text-[11px] text-teal-100">
                Loja
                <select
                  value={slot.slug}
                  onChange={(event) => onChange({ ...slot, slug: event.target.value })}
                  className="truncate bg-transparent p-0 text-[15px] font-semibold text-white [&>option]:text-neutral-900"
                >
                  {stores.map((store) => (
                    <option key={store.slug} value={store.slug}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="flex min-w-0 flex-1 flex-col text-[11px] text-teal-100">
                Loja
                <span className="truncate text-[15px] font-semibold text-white">{storeName(stores, slot.slug)}</span>
              </p>
            )}
            <div className="relative">
              <button
                type="button"
                aria-label="Opções do celular"
                aria-expanded={popover === 'menu'}
                onClick={() => setPopover(popover === 'menu' ? null : 'menu')}
                className="flex size-11 items-center justify-center rounded-full text-xl hover:bg-white/10"
              >
                ⋮
              </button>
              {popover === 'menu' && (
                <div className="absolute right-0 z-10 mt-1 flex w-52 flex-col rounded-[10px] border border-line bg-surface py-1 text-sm text-fg shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setPopover(null);
                      setRestarting(true);
                    }}
                    className={POPOVER_ITEM}
                  >
                    Recomeçar conversa
                  </button>
                  {conversationId && (
                    <a
                      href={`/panel/${slot.slug}?c=${conversationId}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setPopover(null)}
                      className={POPOVER_ITEM}
                    >
                      Abrir no painel ↗
                    </a>
                  )}
                  <button type="button" onClick={onRemove} className={`${POPOVER_ITEM} text-danger-fg`}>
                    Remover
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-teal-100">
            Você é <strong className="text-white">{slot.name}</strong>
            {thread.data?.typing && ' · digitando…'}
          </div>
        </div>

        <div ref={list} className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3 text-sm leading-snug">
          {thread.isError && <p className="m-auto px-4 text-center text-sm text-muted">{threadError(thread.error)}</p>}
          {!thread.isError && !messages.length && !thread.isPending && (
            <p className="m-auto px-4 text-center text-sm text-muted">Mande um "oi" para começar.</p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[80%] whitespace-pre-line break-words rounded-[10px] px-2.5 py-2 ${
                message.author === 'customer' ? 'self-end bg-bubble-out' : 'self-start bg-bubble-in'
              }`}
            >
              <MessageBody body={message.body} />
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-1 bg-surface-2 p-2">
          <div className="relative flex gap-2">
            <button
              type="button"
              aria-label="Anexar"
              aria-expanded={popover === 'attach'}
              disabled={locating === 'busy'}
              onClick={() => setPopover(popover === 'attach' ? null : 'attach')}
              className={`flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-muted transition-transform hover:bg-hover disabled:opacity-50 ${
                popover === 'attach' ? 'rotate-45' : ''
              }`}
            >
              +
            </button>
            {popover === 'attach' && (
              <div className="absolute bottom-full left-0 z-10 mb-2 rounded-2xl border border-line bg-surface p-3 shadow-lg">
                <button
                  type="button"
                  onClick={shareLocation}
                  className="flex flex-col items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-fg hover:bg-hover"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-12 items-center justify-center rounded-full bg-emerald-600 text-xl"
                  >
                    📍
                  </span>
                  Localização
                </button>
              </div>
            )}
            <label className="sr-only" htmlFor={`message-${slot.id}`}>
              Mensagem
            </label>
            <input
              id={`message-${slot.id}`}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                pendingId.current = undefined;
              }}
              maxLength={4000}
              placeholder="Mensagem"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-full border-0 bg-surface px-3.5 text-sm"
            />
            <button
              type="submit"
              aria-label="Enviar"
              disabled={!text.trim() || send.isPending}
              className="flex size-11 items-center justify-center rounded-full bg-[#075e54] text-lg text-white disabled:opacity-50"
            >
              ➤
            </button>
          </div>
          {locating === 'busy' && <p className="px-2 text-xs text-muted">Pegando sua localização…</p>}
          {locating === 'failed' && (
            <p className="px-2 text-xs text-danger-fg">Não foi possível pegar a localização. Permita no navegador.</p>
          )}
          {send.isError && <p className="px-2 text-xs text-danger-fg">Não enviou. Tente de novo.</p>}
        </form>
      </div>
    </section>
  );
}
