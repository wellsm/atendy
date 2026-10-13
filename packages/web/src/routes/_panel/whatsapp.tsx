import type { WhatsAppState } from '../../lib/queries';

import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import { Loading } from '../../components/loading';
import { ApiError } from '../../lib/api';
import { useConnectWhatsApp, useDisconnectWhatsApp, useWhatsAppState } from '../../lib/queries';

export const Route = createFileRoute('/_panel/whatsapp')({
  component: WhatsAppPage
});

/**
 * A QR code expires in about 40 s; ask for a fresh one before that.
 */
const QR_REFRESH_MS = 30_000;

const STATE_BADGE: Record<WhatsAppState, { label: string; className: string }> = {
  connected: { label: 'Conectado', className: 'bg-green-100 text-green-800' },
  connecting: { label: 'Aguardando leitura do QR', className: 'bg-amber-100 text-amber-800' },
  disconnected: { label: 'Desconectado', className: 'bg-neutral-200 text-neutral-700' },
  not_created: { label: 'Não conectado', className: 'bg-neutral-200 text-neutral-700' }
};

function WhatsAppPage() {
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();
  const [showQr, setShowQr] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const status = useWhatsAppState(showQr);

  const state = status.data?.state;
  const connected = state === 'connected';
  const { mutate: requestQr } = connect;

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

  // Keep the QR fresh while the owner is scanning.
  useEffect(() => {
    if (!showQr) {
      return;
    }

    const timer = setInterval(() => requestQr(), QR_REFRESH_MS);

    return () => clearInterval(timer);
  }, [showQr, requestQr]);

  const connectError =
    connect.error instanceof ApiError && connect.error.status === 409
      ? 'O WhatsApp já está conectado.'
      : connect.isError
        ? 'O serviço do WhatsApp não respondeu. Tente novamente em instantes.'
        : undefined;

  return (
    <section className="max-w-2xl">
      <h1 className="text-xl font-semibold">WhatsApp</h1>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        {status.isPending && <Loading />}
        {status.isError && <p className="text-sm text-red-700">Não foi possível ver o status do WhatsApp.</p>}

        {state && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATE_BADGE[state].className}`}>
                {STATE_BADGE[state].label}
              </span>

              {connected
                ? !confirmDisconnect && (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
                    >
                      Desconectar
                    </button>
                  )
                : !showQr && (
                    <button
                      type="button"
                      onClick={startConnect}
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
                    >
                      Conectar
                    </button>
                  )}
            </div>

            {confirmDisconnect && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <p>O bot para de responder até você conectar de novo. Desconectar?</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate(undefined, { onSettled: () => setConfirmDisconnect(false) })}
                    className="rounded-md bg-red-600 px-3 py-2 font-medium text-white disabled:opacity-50"
                  >
                    Desconectar
                  </button>
                  <button type="button" onClick={() => setConfirmDisconnect(false)} className="px-2 py-2">
                    Voltar
                  </button>
                </div>
              </div>
            )}

            {disconnect.isError && (
              <p className="mt-3 text-sm text-red-700">Não foi possível desconectar. Tente novamente.</p>
            )}

            {connected && (
              <p className="mt-4 text-sm text-neutral-600">O bot está respondendo pelo número conectado.</p>
            )}

            {showQr && !connected && (
              <div className="mt-5">
                <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
                  <li>No celular da loja, abra o WhatsApp.</li>
                  <li>Toque em Configurações → Aparelhos conectados → Conectar aparelho.</li>
                  <li>Aponte a câmera para o código abaixo.</li>
                </ol>

                <div className="mt-4 flex flex-col items-center gap-3">
                  {connect.data?.qr_base64 ? (
                    <img
                      src={connect.data.qr_base64}
                      alt="QR code para conectar o WhatsApp"
                      className="h-64 w-64 rounded-lg border border-neutral-200"
                    />
                  ) : (
                    !connectError && <Loading />
                  )}

                  {connect.data?.pairing_code && (
                    <p className="text-sm text-neutral-600">
                      Ou use o código: <span className="font-mono font-semibold">{connect.data.pairing_code}</span>
                    </p>
                  )}

                  {connectError && <p className="text-sm text-red-700">{connectError}</p>}

                  <div className="flex gap-3 text-sm">
                    <button type="button" onClick={() => requestQr()} className="font-medium text-red-700">
                      Gerar novo código
                    </button>
                    <button type="button" onClick={() => setShowQr(false)} className="text-neutral-600">
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        A conexão usa o WhatsApp do celular (não oficial), conforme o aviso aceito no cadastro. Use um número dedicado à
        loja.
      </p>
    </section>
  );
}
