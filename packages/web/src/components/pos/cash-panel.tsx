import type { CashMovement, CashReport, CashSession, PaymentMethod } from '../../lib/queries';

import { useState } from 'react';

import { PrintRow, PrintSheet } from './receipt-print';
import { ApiError } from '../../lib/api';
import { formatMoney, formatWhen, parseMoney, PAYMENT_LABEL } from '../../lib/format';
import {
  useCashCurrent,
  useCashMovement,
  useCashSession,
  useCashSessions,
  useCloseCash,
  useOpenCash,
  useStaff
} from '../../lib/queries';
import { authorName } from '../../lib/staff';

const INPUT =
  'h-11 min-w-0 rounded-lg border border-line-2 bg-surface px-3 text-base focus:border-accent focus:outline-none';

const BUTTON = 'h-11 rounded-lg border border-line-2 px-3 text-sm text-fg-2 hover:bg-hover disabled:opacity-50';

const PRIMARY =
  'h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50';

const METHODS: PaymentMethod[] = ['pix', 'card', 'cash', 'voucher'];

const ERROR_TEXT: Record<string, string> = {
  amount: 'Valor inválido.',
  reason: 'Informe o motivo.',
  session_open: 'Já existe um caixa aberto.',
  no_session: 'O caixa está fechado.',
  already_closed: 'Este caixa já foi fechado.',
  store_blocked: 'PDV indisponível: a loja está bloqueada.'
};

const errorText = (error: unknown) =>
  (error instanceof ApiError && error.field && ERROR_TEXT[error.field]) || 'Não foi possível salvar.';

const differenceText = (cents: number) =>
  cents === 0 ? 'Sem diferença' : cents > 0 ? `Sobra ${formatMoney(cents)}` : `Falta ${formatMoney(-cents)}`;

/**
 * The lines of a "resumo do caixa", shared by the screen and the printed report.
 */
const reportRows = (report: CashReport) => {
  // Blind close (expected hidden): no cash amount at all, nor the sales total (total − other methods = cash).
  const expected = report.expected_cash_cents;
  const blind = expected === null;
  const methods = blind ? METHODS.filter((method) => method !== 'cash') : METHODS;
  const rows: [string, string][] = blind
    ? [[`Vendas (${report.sales_count})`, '']]
    : [
        ['Fundo de troco', formatMoney(report.float_cents)],
        [`Vendas (${report.sales_count})`, formatMoney(report.sales_cents)]
      ];

  for (const method of methods) {
    if (report.by_method[method]) {
      rows.push([`  ${PAYMENT_LABEL[method]}`, formatMoney(report.by_method[method])]);
    }
  }

  if (report.canceled_count) {
    rows.push([`Cancelamentos (${report.canceled_count})`, '']);
  }

  for (const method of methods) {
    if (report.refunds_by_method[method]) {
      rows.push([`  Estorno ${PAYMENT_LABEL[method]}`, `− ${formatMoney(report.refunds_by_method[method])}`]);
    }
  }

  if (report.discounts_cents) {
    rows.push(['Descontos', `− ${formatMoney(report.discounts_cents)}`]);
  }

  if (report.surcharges_cents) {
    rows.push(['Acréscimos', `+ ${formatMoney(report.surcharges_cents)}`]);
  }

  if (blind) {
    rows.push(['Dinheiro', 'Oculto até a contagem']);

    return rows;
  }

  rows.push(
    ['Dinheiro de pedidos (WhatsApp/site)', formatMoney(report.order_cash_cents)],
    ['Suprimentos', `+ ${formatMoney(report.suprimento_cents)}`],
    ['Sangrias', `− ${formatMoney(report.sangria_cents)}`],
    ['Pagamento entregador', `− ${formatMoney(report.courier_payout_cents)}`],
    ['Esperado em dinheiro', formatMoney(expected)]
  );

  if (report.counted_cents !== null) {
    rows.push(['Contado', formatMoney(report.counted_cents)]);
  }

  if (report.difference_cents !== null) {
    rows.push(['Diferença', differenceText(report.difference_cents)]);
  }

  return rows;
};

function ReportList({ report }: { report: CashReport }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
      {reportRows(report).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className={label.startsWith('  ') ? 'pl-3 text-muted' : 'text-fg-2'}>{label.trim()}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A session's report on screen, with its printed copy.
 */
function SessionReport({
  session,
  report,
  storeName,
  receiptWidth
}: {
  session: CashSession;
  report: CashReport;
  storeName: string;
  receiptWidth: 58 | 80;
}) {
  const staff = useStaff().data?.staff;
  const openedBy = authorName(session.opened_by, staff);
  const closedBy = authorName(session.closed_by, staff);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Aberto {formatWhen(session.opened_at)}
        {openedBy && ` por ${openedBy}`}
        {session.closed_at && ` · fechado ${formatWhen(session.closed_at)}${closedBy ? ` por ${closedBy}` : ''}`}
      </p>
      <ReportList report={report} />
      <button type="button" onClick={() => window.print()} className={BUTTON}>
        Imprimir resumo
      </button>
      <PrintSheet width={receiptWidth}>
        <p className="text-center font-bold">{storeName}</p>
        <p className="text-center">Resumo do caixa</p>
        <p className="text-center">
          {formatWhen(session.opened_at)}
          {session.closed_at && ` – ${formatWhen(session.closed_at)}`}
        </p>
        <div className="my-1.5 border-t border-dashed border-black" />
        {reportRows(report).map(([label, value]) => (
          <PrintRow key={label} label={label} value={value} />
        ))}
      </PrintSheet>
    </div>
  );
}

/**
 * Opening float form: in the caixa panel, and in place of the sale while cash control is on and the drawer is closed.
 */
export function OpenCashForm() {
  const open = useOpenCash();
  const [float, setFloat] = useState('');
  const cents = parseMoney(float);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (cents !== undefined) {
          open.mutate({ float_cents: cents });
        }
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-base font-semibold">Abrir caixa</p>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Fundo de troco
        <input
          value={float}
          inputMode="decimal"
          placeholder="0,00"
          onChange={(event) => setFloat(event.target.value)}
          className={INPUT}
        />
      </label>
      {open.isError && <p className="text-sm text-danger-fg">{errorText(open.error)}</p>}
      <button type="submit" disabled={cents === undefined || open.isPending} className={PRIMARY}>
        Abrir caixa
      </button>
    </form>
  );
}

const SLIP_LABEL = { sangria: 'Sangria', suprimento: 'Suprimento' } as const;

/**
 * Sangria or suprimento with a reason; afterwards the slip to print.
 */
function MovementForm({
  kind,
  storeName,
  receiptWidth,
  onDone
}: {
  kind: 'sangria' | 'suprimento';
  storeName: string;
  receiptWidth: 58 | 80;
  onDone: () => void;
}) {
  const move = useCashMovement();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [slip, setSlip] = useState<CashMovement>();
  const cents = parseMoney(amount);

  if (slip) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {SLIP_LABEL[kind]} de {formatMoney(slip.amount_cents)} registrada.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => window.print()} className={BUTTON}>
            Imprimir comprovante
          </button>
          <button type="button" onClick={onDone} className={PRIMARY}>
            OK
          </button>
        </div>
        <PrintSheet width={receiptWidth}>
          <p className="text-center font-bold">{storeName}</p>
          <p className="text-center">{SLIP_LABEL[kind]}</p>
          <p className="text-center">{formatWhen(slip.created_at)}</p>
          <div className="my-1.5 border-t border-dashed border-black" />
          <PrintRow label="Valor" value={formatMoney(slip.amount_cents)} strong />
          <p>Motivo: {slip.reason}</p>
          <p className="mt-6 border-t border-black pt-1 text-center">Assinatura</p>
        </PrintSheet>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (cents) {
          move.mutate(
            { kind, amount_cents: cents, reason: reason.trim() },
            { onSuccess: (data) => setSlip(data.movement) }
          );
        }
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-sm font-semibold">{SLIP_LABEL[kind]}</p>
      <input
        value={amount}
        inputMode="decimal"
        placeholder="Valor"
        autoFocus
        onChange={(event) => setAmount(event.target.value)}
        className={INPUT}
      />
      <input
        value={reason}
        maxLength={200}
        placeholder="Motivo"
        onChange={(event) => setReason(event.target.value)}
        className={INPUT}
      />
      {move.isError && <p className="text-sm text-danger-fg">{errorText(move.error)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onDone} className={BUTTON}>
          Voltar
        </button>
        <button type="submit" disabled={!cents || !reason.trim() || move.isPending} className={PRIMARY}>
          Confirmar
        </button>
      </div>
    </form>
  );
}

/**
 * Counted cash; the close answers the full report (expected and difference, also under blind close).
 */
function CloseForm({
  session,
  onClosed,
  onBack
}: {
  session: CashSession;
  onClosed: (report: CashReport) => void;
  onBack: () => void;
}) {
  const close = useCloseCash();
  const [counted, setCounted] = useState('');
  const cents = parseMoney(counted);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (cents !== undefined) {
          close.mutate(
            { session_id: session.id, counted_cents: cents },
            { onSuccess: (data) => onClosed(data.report) }
          );
        }
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-sm font-semibold">Fechar caixa</p>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Dinheiro contado na gaveta
        <input
          value={counted}
          inputMode="decimal"
          placeholder="0,00"
          autoFocus
          onChange={(event) => setCounted(event.target.value)}
          className={INPUT}
        />
      </label>
      {close.isError && <p className="text-sm text-danger-fg">{errorText(close.error)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onBack} className={BUTTON}>
          Voltar
        </button>
        <button type="submit" disabled={cents === undefined || close.isPending} className={PRIMARY}>
          Confirmar contagem
        </button>
      </div>
    </form>
  );
}

function PastSession({ id, storeName, receiptWidth }: { id: string; storeName: string; receiptWidth: 58 | 80 }) {
  const query = useCashSession(id);

  if (query.isError) {
    return <p className="text-sm text-danger-fg">Não foi possível carregar o resumo.</p>;
  }

  return query.data ? (
    <SessionReport {...query.data} storeName={storeName} receiptWidth={receiptWidth} />
  ) : (
    <p className="text-sm text-muted">Carregando…</p>
  );
}

type View =
  | { kind: 'main' }
  | { kind: 'move'; move: 'sangria' | 'suprimento' }
  | { kind: 'close' }
  | { kind: 'closed'; session: CashSession; report: CashReport }
  | { kind: 'past'; id: string };

/**
 * "Caixa": open with a float, sangria/suprimento, close with the counted cash (blind close hides the expected cash
 * until then), and the closed sessions with their reports.
 */
export function CashPanel({
  storeName,
  receiptWidth,
  onClose
}: {
  storeName: string;
  receiptWidth: 58 | 80;
  onClose: () => void;
}) {
  const current = useCashCurrent();
  const sessions = useCashSessions();
  const [view, setView] = useState<View>({ kind: 'main' });
  const session = current.data?.session;
  const report = current.data?.report;
  const staff = useStaff().data?.staff;
  const closed = sessions.data?.sessions.filter(({ closed_at }) => closed_at) ?? [];
  const main = () => setView({ kind: 'main' });

  return (
    <div role="presentation" onClick={onClose} className="fixed inset-0 z-50 flex justify-end bg-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Caixa"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-surface text-fg"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Caixa</p>
          <div className="flex gap-2">
            {view.kind !== 'main' && (
              <button type="button" onClick={main} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-2">
                Voltar
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-2">
              Fechar
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {view.kind === 'move' && (
            <MovementForm kind={view.move} storeName={storeName} receiptWidth={receiptWidth} onDone={main} />
          )}

          {view.kind === 'close' && session && (
            <CloseForm
              session={session}
              onBack={main}
              onClosed={(closedReport) =>
                setView({
                  kind: 'closed',
                  session: { ...session, closed_at: new Date().toISOString() },
                  report: closedReport
                })
              }
            />
          )}

          {view.kind === 'closed' && (
            <>
              <p className="text-base font-semibold">Caixa fechado</p>
              <SessionReport
                session={view.session}
                report={view.report}
                storeName={storeName}
                receiptWidth={receiptWidth}
              />
            </>
          )}

          {view.kind === 'past' && <PastSession id={view.id} storeName={storeName} receiptWidth={receiptWidth} />}

          {view.kind === 'main' && (
            <>
              {current.isPending && <p className="text-sm text-muted">Carregando…</p>}
              {current.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o caixa.</p>}
              {current.data && !session && <OpenCashForm />}
              {session && report && (
                <div className="flex flex-col gap-3">
                  <p className="text-base font-semibold">
                    Caixa aberto{' '}
                    <span className="text-sm font-normal text-muted">
                      · {formatWhen(session.opened_at)}
                      {authorName(session.opened_by, staff) && ` por ${authorName(session.opened_by, staff)}`}
                    </span>
                  </p>
                  <ReportList report={report} />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setView({ kind: 'move', move: 'sangria' })} className={BUTTON}>
                      Sangria
                    </button>
                    <button
                      type="button"
                      onClick={() => setView({ kind: 'move', move: 'suprimento' })}
                      className={BUTTON}
                    >
                      Suprimento
                    </button>
                  </div>
                  <button type="button" onClick={() => setView({ kind: 'close' })} className={PRIMARY}>
                    Fechar caixa
                  </button>
                </div>
              )}

              {closed.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">Caixas fechados</p>
                  <ul>
                    {closed.map((past) => (
                      <li key={past.id}>
                        <button
                          type="button"
                          onClick={() => setView({ kind: 'past', id: past.id })}
                          className="flex w-full items-center gap-3 border-b border-line py-3 text-left text-sm hover:bg-hover"
                        >
                          <span className="flex-1">
                            {formatWhen(past.opened_at)} – {formatWhen(past.closed_at)}
                          </span>
                          {past.counted_cents !== null && past.expected_cents !== null && (
                            <span className="text-xs text-muted">
                              {differenceText(past.counted_cents - past.expected_cents)}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
