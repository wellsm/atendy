import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { WhatsAppState } from '../lib/queries';

import { useCallback, useEffect, useState } from 'react';

import { Loading } from './loading';
import { ApiError } from '../lib/api';

/**
 * Where the WhatsApp block reads and acts: the store's own routes or the admin ones for a given store.
 */
export type WhatsAppHooks = {
  useState: (poll: boolean) => UseQueryResult<{ state: WhatsAppState }>;
  useConnect: () => UseMutationResult<{ qr_base64: string | null; pairing_code: string | null }, Error, void>;
  useDisconnect: () => UseMutationResult<{ state: WhatsAppState }, Error, void>;
};

/**
 * A QR code expires in about 40 s; ask for a fresh one before that.
 */
const QR_REFRESH_SECONDS = 30;

/**
 * Texts that say what the number is for: each state's headline, the disconnect confirmation and the notes under the
 * card while connected or disconnected.
 */
export type WhatsAppCopy = {
  headline: Record<WhatsAppState, string>;
  confirmDisconnect: string;
  connectedNote: string;
  disconnectedNote: string;
};

/**
 * The store's number, answered by the bot.
 */
const STORE_COPY: WhatsAppCopy = {
  headline: {
    connected: 'O bot está atendendo pelo número conectado.',
    connecting: 'Escaneie o código com o WhatsApp do celular da loja.',
    disconnected: 'O WhatsApp foi desconectado. Conecte de novo para o bot voltar a responder.',
    not_created: 'Conecte o WhatsApp da loja para o bot começar a atender.'
  },
  confirmDisconnect: 'O bot para de responder até você conectar de novo. Desconectar?',
  connectedNote: 'O bot está respondendo pelo número conectado.',
  disconnectedNote: 'O bot não está respondendo. Os clientes não recebem resposta até você conectar de novo.'
};

const STATE_STYLE: Record<WhatsAppState, { label: string; badge: string; icon: string; dot: string }> = {
  connected: {
    label: 'Conectado',
    badge: 'bg-ok-bg text-ok-fg',
    icon: 'bg-ok-bg',
    dot: 'bg-on ring-ok-bg'
  },
  connecting: {
    label: 'Aguardando leitura do QR',
    badge: 'bg-accepted-bg text-warn-fg',
    icon: 'bg-warn-bg',
    dot: 'bg-amber-500 ring-accepted-bg'
  },
  disconnected: {
    label: 'Desconectado',
    badge: 'bg-line text-fg-2',
    icon: 'bg-surface-2',
    dot: 'bg-faint ring-surface-2'
  },
  not_created: {
    label: 'Não conectado',
    badge: 'bg-line text-fg-2',
    icon: 'bg-surface-2',
    dot: 'bg-faint ring-surface-2'
  }
};

const QR_STEPS = [
  'No celular da loja, abra o WhatsApp.',
  'Toque em Configurações → Aparelhos conectados → Conectar aparelho.',
  'Aponte a câmera para o código.'
];

const PAIRING_STEPS = [
  'No WhatsApp da loja, vá em Aparelhos conectados → Conectar aparelho.',
  'Toque em “Conectar com número de telefone”.',
  'Digite o código acima.'
];

/**
 * State card, QR code to link the number (refreshed while scanning) and disconnect. `copy` defaults to the store's
 * texts (the bot answering).
 */
export function WhatsAppConnect({ hooks, copy = STORE_COPY }: { hooks: WhatsAppHooks; copy?: WhatsAppCopy }) {
  const connect = hooks.useConnect();
  const disconnect = hooks.useDisconnect();
  const [showQr, setShowQr] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(QR_REFRESH_SECONDS);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const status = hooks.useState(showQr);

  const state = status.data?.state;
  const connected = state === 'connected';
  const { mutate } = connect;

  const requestQr = useCallback(() => {
    setSecondsLeft(QR_REFRESH_SECONDS);
    mutate();
  }, [mutate]);

  const startConnect = useCallback(() => {
    setShowQr(true);
    requestQr();
  }, [requestQr]);

  // Linked: stop polling and drop the QR.
  useEffect(() => {
    if (connected) {
      setShowQr(false);
    }
  }, [connected]);

  // Count down while the owner is scanning.
  useEffect(() => {
    if (!showQr) {
      return;
    }

    const timer = setInterval(() => setSecondsLeft((seconds) => seconds - 1), 1000);

    return () => clearInterval(timer);
  }, [showQr]);

  // Keep the QR fresh: ask for a new one when the countdown ends.
  useEffect(() => {
    if (showQr && secondsLeft <= 0) {
      requestQr();
    }
  }, [showQr, secondsLeft, requestQr]);

  const connectError =
    connect.error instanceof ApiError && connect.error.status === 409
      ? 'O WhatsApp já está conectado.'
      : connect.isError
        ? 'O serviço do WhatsApp não respondeu. Tente novamente em instantes.'
        : undefined;

  if (status.isPending) {
    return (
      <div className="rounded-xl border border-line bg-surface">
        <Loading />
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5 text-sm text-accent-fg">
        Não foi possível ver o status do WhatsApp.
      </div>
    );
  }

  const shown = showQr ? 'connecting' : state;
  const style = STATE_STYLE[shown];
  const qr = connect.data?.qr_base64;
  const pairingCode = connect.data?.pairing_code;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14 sm:rounded-2xl ${style.icon}`}
          >
            <span className={`h-3 w-3 rounded-full ring-[5px] sm:h-4 sm:w-4 sm:ring-[6px] ${style.dot}`} />
          </span>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${style.badge}`}>{style.label}</span>
            <span className="text-[15px] text-fg-2">{copy.headline[shown]}</span>
          </div>
        </div>

        {connected
          ? !confirmDisconnect && (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="h-12 rounded-xl border border-line-2 bg-surface px-4 text-[15px] text-fg-2 sm:h-10.5 sm:rounded-lg sm:text-sm"
              >
                Desconectar
              </button>
            )
          : !showQr && (
              <button
                type="button"
                onClick={startConnect}
                className="h-12 rounded-xl bg-accent px-5 text-[15px] font-semibold text-white sm:h-10.5 sm:rounded-lg sm:text-sm"
              >
                Conectar
              </button>
            )}
      </div>

      {confirmDisconnect && (
        <div className="mx-5 mb-5 flex flex-col gap-3 rounded-lg border border-accent-line bg-accent-soft p-3 text-sm text-accent-fg sm:mx-6 sm:mb-6 sm:flex-row sm:items-center sm:px-4">
          <p className="flex-1">{copy.confirmDisconnect}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate(undefined, { onSettled: () => setConfirmDisconnect(false) })}
              className="h-11 flex-1 rounded-lg bg-accent px-3.5 font-medium text-white disabled:opacity-50 sm:h-9 sm:flex-none"
            >
              Desconectar
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              className="h-11 flex-1 rounded-lg border border-accent-line bg-surface px-3 sm:h-9 sm:flex-none sm:border-0 sm:bg-transparent"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {disconnect.isError && (
        <p className="mx-5 mb-5 text-sm text-accent-fg sm:mx-6">Não foi possível desconectar. Tente novamente.</p>
      )}

      {connected && !confirmDisconnect && (
        <p className="border-t border-line px-5 py-4 text-sm text-muted sm:px-6">{copy.connectedNote}</p>
      )}

      {state === 'disconnected' && !showQr && (
        <p className="border-t border-line px-5 py-4 text-sm text-muted sm:px-6">{copy.disconnectedNote}</p>
      )}

      {showQr && !connected && (
        <div className="grid gap-5 border-t border-line p-5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-8 sm:px-6 sm:py-7">
          <p className="-order-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-fg sm:hidden">
            No celular, o QR precisa ser lido por <b>outro aparelho</b>. Abra este painel no computador
            {pairingCode ? ' ou use o código de pareamento abaixo.' : '.'}
          </p>

          <div className="flex flex-col gap-4">
            <Steps steps={QR_STEPS} className={pairingCode ? 'hidden sm:flex' : 'flex'} />
            {pairingCode && <Steps steps={PAIRING_STEPS} className="flex sm:hidden" />}

            {connectError && <p className="text-sm text-accent-fg">{connectError}</p>}

            <div className="flex items-center gap-2 text-sm sm:mt-1 sm:gap-4">
              <button
                type="button"
                onClick={requestQr}
                className="h-11 flex-1 rounded-lg border border-accent-line bg-accent-soft font-medium text-accent-fg sm:h-auto sm:flex-none sm:border-0 sm:bg-transparent"
              >
                Gerar novo código
              </button>
              <button type="button" onClick={() => setShowQr(false)} className="h-11 px-3 text-muted sm:h-auto sm:px-0">
                Cancelar
              </button>
            </div>
          </div>

          <div className="-order-1 flex flex-col items-center gap-2.5 sm:order-none">
            {qr ? (
              <img
                src={qr}
                alt="QR code para conectar o WhatsApp"
                className={`aspect-square w-full max-w-64 rounded-xl border border-line ${pairingCode ? 'hidden sm:block' : ''}`}
              />
            ) : (
              !connectError && <Loading />
            )}

            {pairingCode && (
              <p className="flex flex-col items-center gap-1 text-sm text-muted sm:block">
                <span className="text-[13px] text-muted sm:text-sm sm:text-muted">
                  <span className="sm:hidden">Código de pareamento</span>
                  <span className="hidden sm:inline">Ou use o código: </span>
                </span>
                <span className="font-mono text-[28px] font-bold tracking-widest text-fg sm:text-sm sm:font-semibold sm:tracking-wider sm:text-muted">
                  {pairingCode}
                </span>
              </p>
            )}

            <div className="hidden h-1 w-full max-w-64 overflow-hidden rounded bg-surface-2 sm:block">
              <div
                className="h-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${(Math.max(secondsLeft, 0) / QR_REFRESH_SECONDS) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted">Novo código em {Math.max(secondsLeft, 0)} s</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Steps({ steps, className }: { steps: string[]; className: string }) {
  return (
    <ol className={`flex-col gap-3 sm:gap-4.5 ${className}`}>
      {steps.map((step, index) => (
        <li key={step} className="flex items-start gap-3 sm:gap-3.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-fg sm:h-7 sm:w-7 sm:text-[13px]">
            {index + 1}
          </span>
          <span className="pt-0.5 text-sm leading-normal text-fg sm:pt-[3px] sm:text-[15px]">{step}</span>
        </li>
      ))}
    </ol>
  );
}
