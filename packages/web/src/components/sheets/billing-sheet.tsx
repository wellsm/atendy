import type { FormEvent } from 'react';
import type { BillingCardInput, BillingInvoice, BillingSummary, InvoiceStatus } from '../../lib/queries';

import { useState } from 'react';

import { Sheet, SheetHeader } from './sheet';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useBilling, useUpdateBillingCard } from '../../lib/queries';
import { Loading } from '../loading';

const INPUT =
  'w-full rounded-lg border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:bg-hover';

const STATUS: Record<InvoiceStatus, { label: string; className: string }> = {
  pending: { label: 'Agendada', className: 'bg-surface-2 text-fg-2' },
  paid: { label: 'Paga', className: 'bg-ok-bg text-ok-fg' },
  overdue: { label: 'Em aberto', className: 'bg-placed-bg text-danger-fg' },
  in_review: { label: 'Em análise', className: 'bg-accepted-bg text-warn-fg' }
};

const FAILURE: Record<string, string> = {
  card_refused: 'cartão recusado',
  risk_reproved: 'recusada na análise de risco',
  no_card: 'sem cartão cadastrado',
  overdue: 'vencida'
};

/**
 * Portuguese text per API error field.
 */
const FIELD_ERROR: Record<string, string> = {
  'holder.name': 'Informe o nome do titular.',
  'holder.cpf_cnpj': 'CPF ou CNPJ precisa ter 11 ou 14 dígitos.',
  'holder.email': 'Confira o e-mail.',
  'holder.phone': 'Informe o celular com DDD.',
  'holder.postal_code': 'O CEP precisa ter 8 dígitos.',
  'holder.address_number': 'Informe o número do endereço.',
  'card.number': 'Confira o número do cartão.',
  'card.holder_name': 'Informe o nome impresso no cartão.',
  'card.expiry': 'Validade inválida ou cartão vencido.',
  'card.ccv': 'Confira o código de segurança.',
  card: 'Cartão não autorizado. Confira os dados ou use outro cartão.'
};

const errorText = (error: unknown) =>
  error instanceof ApiError && error.status === 400
    ? (error.field && FIELD_ERROR[error.field]) || 'Algum dado não é válido. Confira e tente de novo.'
    : 'Não foi possível salvar o cartão. Tente novamente.';

const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

const formatDay = (day: string) => date.format(new Date(`${day}T00:00:00Z`));

export function BillingSheet({ onClose }: { onClose: () => void }) {
  const billing = useBilling();

  return (
    <Sheet width="md" label="Pagamento" onClose={onClose}>
      <SheetHeader
        title="Pagamento"
        subtitle="Você paga por pedido atendido pelo bot. O ciclo fecha todo dia 1 e a cobrança cai no cartão no dia 5."
        onClose={onClose}
      />
      <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        {billing.isPending && <Loading />}
        {billing.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o pagamento.</p>}
        {billing.data && <BillingSections summary={billing.data} />}
      </div>
    </Sheet>
  );
}

function BillingSections({ summary }: { summary: BillingSummary }) {
  const overdue = summary.invoices.filter(({ status }) => status === 'overdue');

  return (
    <>
      {summary.blocked && (
        <p className="rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-fg">
          O bot está pausado por uma fatura em aberto. Atualize o cartão ou pague pelo link da fatura para voltar a
          atender.
        </p>
      )}
      {!summary.blocked && overdue.length > 0 && (
        <p className="rounded-xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-fg">
          Há fatura em aberto. Depois de 7 dias do vencimento o bot é pausado até o pagamento.
        </p>
      )}
      {!summary.card && !summary.blocked && (
        <p className="rounded-xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-fg">
          Cadastre um cartão para a cobrança mensal. O cartão é validado sem cobrança.
        </p>
      )}

      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 text-sm sm:grid-cols-3 sm:p-6">
        <div>
          <p className="text-xs text-muted">Neste ciclo (até agora)</p>
          <p className="text-lg font-semibold">{formatMoney(summary.open.amount_cents)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Atendimentos cobrados</p>
          <p className="text-lg font-semibold">{summary.open.orders}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Preço por pedido</p>
          <p className="text-lg font-semibold">{formatMoney(summary.price_cents)}</p>
        </div>
      </div>

      <CardForm summary={summary} />

      <div className="rounded-2xl border border-line bg-surface">
        <h2 className="px-4 pt-5 text-base font-semibold sm:px-6">Faturas</h2>
        {!summary.invoices.length && <p className="px-4 py-4 text-sm text-muted sm:px-6">Nenhuma fatura ainda.</p>}
        <ul className="mt-2 divide-y divide-line">
          {summary.invoices.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} />
          ))}
        </ul>
      </div>
    </>
  );
}

function InvoiceRow({ invoice }: { invoice: BillingInvoice }) {
  const status = STATUS[invoice.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-6">
      <div className="min-w-0">
        <p className="font-medium capitalize">{month.format(new Date(invoice.period_start))}</p>
        <p className="text-xs text-muted">
          {invoice.orders} atendimentos · vence {formatDay(invoice.due_date)}
          {invoice.failure_reason &&
            invoice.status !== 'paid' &&
            ` · ${FAILURE[invoice.failure_reason] ?? invoice.failure_reason}`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-medium">{formatMoney(invoice.amount_cents)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
        {invoice.status === 'overdue' && invoice.invoice_url && (
          <a
            href={invoice.invoice_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-accent-fg hover:text-accent-fg"
          >
            Pagar com Pix ↗
          </a>
        )}
      </div>
    </li>
  );
}

const EMPTY: BillingCardInput = {
  holder: { name: '', cpf_cnpj: '', email: '', phone: '', postal_code: '', address_number: '' },
  card: { holder_name: '', number: '', expiry_month: '', expiry_year: '', ccv: '' }
};

function CardForm({ summary }: { summary: BillingSummary }) {
  const update = useUpdateBillingCard();
  const [open, setOpen] = useState(!summary.card);
  const [form, setForm] = useState(EMPTY);

  const holder = (key: keyof BillingCardInput['holder']) => ({
    value: form.holder[key],
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, holder: { ...current.holder, [key]: event.target.value } }))
  });

  const card = (key: keyof BillingCardInput['card']) => ({
    value: form.card[key],
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, card: { ...current.card, [key]: event.target.value } }))
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    update.mutate(form, {
      // The card is never kept after it reached Asaas.
      onSuccess: () => {
        setForm(EMPTY);
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-sm sm:p-6">
        <div>
          <p className="text-xs text-muted">Cartão de cobrança</p>
          <p className="font-medium">
            {summary.card ? `${summary.card.brand} •••• ${summary.card.last4}` : 'Nenhum cartão'}
          </p>
          {update.isSuccess && <p className="text-xs text-ok-fg">✓ Cartão salvo</p>}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 rounded-lg border border-line-2 px-4 text-sm hover:bg-hover"
        >
          {summary.card ? 'Trocar cartão' : 'Cadastrar cartão'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="space-y-4 px-4 py-5 sm:px-6">
        <div>
          <h2 className="text-base font-semibold">{summary.card ? 'Trocar cartão' : 'Cadastrar cartão'}</h2>
          <p className="mt-1 text-sm text-muted">
            Os dados vão direto para o Asaas, nosso processador de pagamentos. O Atendy guarda só a bandeira e o final
            do cartão.
          </p>
        </div>

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={update.isPending}>
          <legend className="mb-2 text-sm font-medium">Titular</legend>
          <input {...holder('name')} placeholder="Nome completo" autoComplete="name" className={INPUT} />
          <input {...holder('cpf_cnpj')} placeholder="CPF ou CNPJ" inputMode="numeric" className={INPUT} />
          <input {...holder('email')} placeholder="E-mail" type="email" autoComplete="email" className={INPUT} />
          <input
            {...holder('phone')}
            placeholder="Celular com DDD"
            inputMode="tel"
            autoComplete="tel"
            className={INPUT}
          />
          <input
            {...holder('postal_code')}
            placeholder="CEP"
            inputMode="numeric"
            autoComplete="postal-code"
            className={INPUT}
          />
          <input {...holder('address_number')} placeholder="Número do endereço" className={INPUT} />
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-4" disabled={update.isPending}>
          <legend className="mb-2 text-sm font-medium">Cartão de crédito</legend>
          <input
            {...card('number')}
            placeholder="Número do cartão"
            inputMode="numeric"
            autoComplete="cc-number"
            className={`${INPUT} sm:col-span-4`}
          />
          <input
            {...card('holder_name')}
            placeholder="Nome impresso no cartão"
            autoComplete="cc-name"
            className={`${INPUT} sm:col-span-4`}
          />
          <input
            {...card('expiry_month')}
            placeholder="Mês (MM)"
            inputMode="numeric"
            autoComplete="cc-exp-month"
            className={INPUT}
          />
          <input
            {...card('expiry_year')}
            placeholder="Ano (AAAA)"
            inputMode="numeric"
            autoComplete="cc-exp-year"
            className={INPUT}
          />
          <input
            {...card('ccv')}
            placeholder="CVV"
            inputMode="numeric"
            autoComplete="cc-csc"
            className={`${INPUT} sm:col-span-2`}
          />
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-hover px-4 py-3.5 sm:px-6">
        <button
          type="submit"
          disabled={update.isPending}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {update.isPending ? 'Validando cartão…' : 'Salvar cartão'}
        </button>
        {summary.card && (
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => setOpen(false)}
            className="h-9 rounded-lg px-3 text-sm text-muted hover:bg-surface-2"
          >
            Cancelar
          </button>
        )}
        {update.isError && <span className="text-sm text-danger-fg">{errorText(update.error)}</span>}
      </div>
    </form>
  );
}
