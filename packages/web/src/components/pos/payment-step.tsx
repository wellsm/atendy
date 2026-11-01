import type { PaymentMethod, PosSale } from '../../lib/queries';

import { useEffect, useRef, useState } from 'react';

import { PrintSheet, SaleReceipt } from './receipt-print';
import { ApiError } from '../../lib/api';
import { centsToInput, formatMoney, parseMoney, PAYMENT_LABEL } from '../../lib/format';
import { useFinalizePosSale, useSendPosReceipt } from '../../lib/queries';

const INPUT =
  'h-11 min-w-0 rounded-lg border border-line-2 bg-surface px-3 text-base tabular-nums focus:border-accent focus:outline-none';

const BUTTON = 'h-11 rounded-lg border border-line-2 px-3 text-sm text-fg-2 hover:bg-hover disabled:opacity-50';

const QUICK_CASH = [2000, 5000, 10000];

const ERROR_TEXT: Record<string, string> = {
  payments: 'Os pagamentos precisam somar o total.',
  method: 'A loja não aceita essa forma de pagamento.',
  no_lines: 'A venda não tem itens.',
  cash_closed: 'Abra o caixa antes de cobrar.',
  store_blocked: 'PDV indisponível: a loja está bloqueada.'
};

type Row = { method: PaymentMethod; amount: string; received: string };

/**
 * "Cobrar": the store's methods, split rows, what is left, cash received and change; then the code ("Senha" when the
 * sale goes to the kitchen), print, WhatsApp and "Nova venda". Finalizing detaches the sale from the screen first
 * (`onDetach`): the screen would read its new status as "finalized elsewhere".
 */
export function PaymentStep({
  sale,
  methods,
  storeName,
  receiptWidth,
  onDetach,
  onBack,
  onNew
}: {
  sale: PosSale;
  methods: PaymentMethod[];
  storeName: string;
  receiptWidth: 58 | 80;
  onDetach: () => void;
  onBack: () => void;
  onNew: () => void;
}) {
  const finalize = useFinalizePosSale();
  const sendReceipt = useSendPosReceipt();
  const total = sale.total_cents;
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<PosSale>();
  const [error, setError] = useState<string>();

  const parsed = rows.map((row) => {
    const amount = parseMoney(row.amount) ?? 0;
    const received = row.method === 'cash' && row.received.trim() ? (parseMoney(row.received) ?? -1) : null;

    return { method: row.method, amount, received };
  });
  const paid = parsed.reduce((sum, { amount }) => sum + amount, 0);
  const remaining = total - paid;
  const ready =
    remaining === 0 && parsed.every(({ amount, received }) => amount > 0 && (received === null || received >= amount));

  // Esc: back to the sale (not while finalizing), or "Nova venda" once paid.
  const escape = useRef<() => void>(() => undefined);

  escape.current = () => {
    if (result) {
      onNew();
    } else if (!finalize.isPending) {
      onBack();
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        escape.current();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // The first row (first method, full total) as soon as the store's methods are known, also if they load late.
  const firstMethod = methods[0];

  useEffect(() => {
    if (total > 0 && firstMethod) {
      setRows((current) =>
        current.length ? current : [{ method: firstMethod, amount: centsToInput(total), received: '' }]
      );
    }
  }, [firstMethod, total]);

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const addRow = () => {
    const method = methods.find((value) => !rows.some((row) => row.method === value)) ?? methods[0]!;

    setRows([...rows, { method, amount: centsToInput(remaining), received: '' }]);
  };

  const submit = () => {
    if (!ready || finalize.isPending) {
      return;
    }

    setError(undefined);
    onDetach();
    finalize.mutate(
      {
        sale_id: sale.id,
        payments: parsed.map(({ method, amount, received }) => ({
          method,
          amount_cents: amount,
          ...(received !== null && { received_cents: received })
        }))
      },
      {
        onSuccess: (data) => setResult(data.sale),
        onError: (failure) =>
          setError(
            (failure instanceof ApiError && failure.field && ERROR_TEXT[failure.field]) ||
              'Não foi possível finalizar. Tente de novo.'
          )
      }
    );
  };

  const change = result?.payments.reduce((sum, { change_cents }) => sum + (change_cents ?? 0), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex bg-surface text-fg md:items-center md:justify-center md:bg-overlay md:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cobrar"
        className="flex w-full flex-col bg-surface md:max-h-[90dvh] md:max-w-md md:rounded-xl md:border md:border-line"
      >
        {!result ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">Cobrar</p>
              <button
                type="button"
                disabled={finalize.isPending}
                onClick={onBack}
                className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-2 disabled:opacity-50"
              >
                Voltar
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-bold tabular-nums">{formatMoney(total)}</span>
                {remaining !== 0 && (
                  <span className="text-sm font-medium text-accent-fg">
                    {remaining > 0 ? `falta ${formatMoney(remaining)}` : `passou ${formatMoney(-remaining)}`}
                  </span>
                )}
              </p>

              {total > 0 && !methods.length && (
                <p className="text-sm text-danger-fg">Nenhuma forma de pagamento ativa (Configurações › Pagamento).</p>
              )}

              {rows.map((row, index) => {
                const { amount, received } = parsed[index]!;

                return (
                  <div key={index} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                    <div className="grid grid-cols-2 gap-1.5">
                      {methods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setRow(index, { method, received: method === 'cash' ? row.received : '' })}
                          className={`h-10 rounded-lg border text-sm ${row.method === method ? 'border-fg bg-fg font-semibold text-surface' : 'border-line-2 text-fg-2 hover:bg-hover'}`}
                        >
                          {PAYMENT_LABEL[method]}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
                        Valor
                        <input
                          value={row.amount}
                          inputMode="decimal"
                          onChange={(event) => setRow(index, { amount: event.target.value })}
                          className={INPUT}
                        />
                      </label>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remover pagamento"
                          onClick={() => setRows(rows.filter((_row, at) => at !== index))}
                          className={`${BUTTON} mt-5 w-11 px-0`}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {row.method === 'cash' && (
                      <>
                        <label className="flex flex-col gap-1 text-xs text-muted">
                          Recebido em dinheiro
                          <input
                            value={row.received}
                            inputMode="decimal"
                            placeholder="Opcional"
                            onChange={(event) => setRow(index, { received: event.target.value })}
                            className={INPUT}
                          />
                        </label>
                        <div className="grid grid-cols-4 gap-1.5">
                          <button
                            type="button"
                            disabled={!amount}
                            onClick={() => setRow(index, { received: centsToInput(amount) })}
                            className={BUTTON}
                          >
                            Exato
                          </button>
                          {QUICK_CASH.map((cents) => (
                            <button
                              key={cents}
                              type="button"
                              disabled={cents < amount}
                              onClick={() => setRow(index, { received: centsToInput(cents) })}
                              className={BUTTON}
                            >
                              {cents / 100}
                            </button>
                          ))}
                        </div>
                        {received !== null &&
                          (received >= amount ? (
                            <p className="text-lg font-bold tabular-nums">Troco: {formatMoney(received - amount)}</p>
                          ) : (
                            <p className="text-sm text-danger-fg">O valor recebido não cobre o pagamento.</p>
                          ))}
                      </>
                    )}
                  </div>
                );
              })}

              {methods.length > 0 && remaining > 0 && (
                <button type="button" onClick={addRow} className={`${BUTTON} self-start`}>
                  + Outra forma de pagamento
                </button>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
              {error && <p className="text-sm text-danger-fg">{error}</p>}
              <button
                type="submit"
                autoFocus
                disabled={!ready || finalize.isPending}
                className="h-14 rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {finalize.isPending ? 'Finalizando…' : 'Finalizar'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
              {result.status === 'canceled' ? (
                <p className="text-lg font-semibold">Esta venda foi cancelada.</p>
              ) : result.status === 'accepted' ? (
                <>
                  <p className="text-4xl font-bold">Senha #{result.code}</p>
                  <p className="text-sm text-muted">Enviada para o preparo.</p>
                </>
              ) : (
                <p className="text-2xl font-bold">Venda #{result.code} concluída</p>
              )}
              {result.status !== 'canceled' && change > 0 && (
                <p className="text-xl font-semibold tabular-nums">Troco: {formatMoney(change)}</p>
              )}
              {sendReceipt.isSuccess && <p className="text-sm text-ok-fg">Comprovante enviado no WhatsApp.</p>}
              {sendReceipt.isError && <p className="text-sm text-danger-fg">Não foi possível enviar no WhatsApp.</p>}
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
              {result.status !== 'canceled' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className={`${BUTTON} ${result.customer?.phone ? '' : 'col-span-2'}`}
                  >
                    Imprimir
                  </button>
                  {result.customer?.phone && (
                    <button
                      type="button"
                      disabled={sendReceipt.isPending || sendReceipt.isSuccess}
                      onClick={() => sendReceipt.mutate(result.id)}
                      className={BUTTON}
                    >
                      Enviar no WhatsApp
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                autoFocus
                onClick={onNew}
                className="h-14 rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent-hover"
              >
                Nova venda
              </button>
            </div>

            {result.status !== 'canceled' && (
              <PrintSheet width={receiptWidth}>
                <SaleReceipt storeName={storeName} sale={result} />
              </PrintSheet>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
