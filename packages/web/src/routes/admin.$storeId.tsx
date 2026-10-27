import type { FormEvent, ReactNode } from 'react';
import type { AdminStoreDetail, BillingSummary, DemoMenuKind, InvoiceStatus, RouterType } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { Toggle } from '../components/toggle';
import { WhatsAppConnect } from '../components/whatsapp-connect';
import { ApiError } from '../lib/api';
import { centsToInput, formatMoney, formatWhen, handoffLabel, parseMoney } from '../lib/format';
import {
  adminWhatsAppHooks,
  useAdminStore,
  useChargeAdminBillingNow,
  useRunAdminBilling,
  useSeedDemoMenu,
  useUpdateAdminStore
} from '../lib/queries';

export const Route = createFileRoute('/admin/$storeId')({
  component: () => (
    <SignedIn>
      <AdminStorePage />
    </SignedIn>
  )
});

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';

const ROUTER_LABEL: Record<RouterType, string> = {
  jev: 'Jev (decide rápido, LLM só quando precisa)',
  llm: 'LLM em todo turno'
};

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: 'agendada',
  paid: 'paga',
  overdue: 'em aberto',
  in_review: 'em análise'
};

const DEMO_MENU_LABEL: Record<DemoMenuKind, string> = {
  pizzeria: 'Pizzaria',
  burger: 'Hamburgueria',
  snack_bar: 'Lanchonete',
  pasta: 'Massas',
  pastry: 'Pastelaria',
  acai: 'Açaí',
  lunchbox: 'Marmitaria',
  japanese: 'Japonês'
};

function AdminStorePage() {
  const { storeId } = Route.useParams();
  const detail = useAdminStore(storeId);
  const forbidden = detail.error instanceof ApiError && detail.error.status === 403;
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin" className="text-sm text-neutral-500">
            ← Lojas
          </Link>
          <h1 className="truncate text-xl font-semibold">{detail.data?.store.name ?? 'Loja'}</h1>
        </div>
        <UserButton />
      </header>

      {detail.isPending && <Loading />}
      {forbidden && <p className="text-sm text-neutral-600">Sem acesso.</p>}
      {notFound && <p className="text-sm text-neutral-600">Loja não encontrada.</p>}
      {detail.isError && !forbidden && !notFound && (
        <p className="text-sm text-red-700">Não foi possível carregar a loja.</p>
      )}

      {detail.data && <Sections key={storeId} storeId={storeId} detail={detail.data} />}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function Sections({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const whatsAppHooks = useMemo(() => adminWhatsAppHooks(storeId), [storeId]);

  return (
    <div className="flex flex-col gap-4">
      <ActivationCard storeId={storeId} active={detail.store.active} />
      <HealthCard detail={detail} />
      <BotCard storeId={storeId} detail={detail} />
      <MemoryCard storeId={storeId} hours={detail.order_memory_hours} />
      <PriceCard storeId={storeId} detail={detail} />
      <OrderCodeCard storeId={storeId} detail={detail} />
      {detail.billing && <PaymentCard storeId={storeId} billing={detail.billing} />}
      <MenuCard storeId={storeId} activeProducts={detail.health.active_products} />
      <div>
        <h2 className="mb-2 font-semibold">WhatsApp</h2>
        <WhatsAppConnect hooks={whatsAppHooks} />
      </div>
    </div>
  );
}

function ActivationCard({ storeId, active }: { storeId: string; active: boolean }) {
  const update = useUpdateAdminStore(storeId);

  return (
    <Card title="Ativação">
      <div className="flex items-center gap-3">
        <Toggle
          checked={active}
          disabled={update.isPending}
          label="Loja ativa"
          onChange={(checked) => update.mutate({ active: checked })}
        />
        <span>{active ? 'Ativa: o bot atende o WhatsApp desta loja.' : 'Pendente: o bot ignora o WhatsApp.'}</span>
      </div>
      {update.isError && <p className="mt-2 text-red-700">Não foi possível alterar.</p>}
    </Card>
  );
}

function HealthCard({ detail }: { detail: AdminStoreDetail }) {
  const { health } = detail;

  return (
    <Card title="Saúde">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-neutral-500">Aberta agora (horário)</dt>
        <dd>{health.open_now ? 'Sim' : 'Não'}</dd>
        <dt className="text-neutral-500">Aceitando pedidos</dt>
        <dd>{health.accepting_orders ? 'Sim' : 'Não'}</dd>
        <dt className="text-neutral-500">Produtos ativos</dt>
        <dd>{health.active_products}</dd>
        <dt className="text-neutral-500">Última mensagem</dt>
        <dd>{health.last_message_at ? formatWhen(health.last_message_at) : 'nenhuma'}</dd>
        <dt className="text-neutral-500">Erros nas últimas 24h</dt>
        <dd className={health.error_count_24h ? 'font-medium text-red-700' : undefined}>{health.error_count_24h}</dd>
      </dl>

      {health.recent_errors.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-100">
          {health.recent_errors.map((error) => (
            <li key={error.conversation_id} className="flex justify-between gap-3 px-3 py-2">
              <span>{handoffLabel(error.reason)}</span>
              <span className="text-neutral-500">{formatWhen(error.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BotCard({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const update = useUpdateAdminStore(storeId);
  const [router, setRouter] = useState(detail.store.router);
  const [model, setModel] = useState(detail.store.llm_model);
  const unlisted = !detail.models.includes(detail.store.llm_model);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ router, ...(detail.models.includes(model) && { llm_model: model }) });
  };

  return (
    <Card title="Bot">
      <form onSubmit={submit} className="flex flex-col gap-3">
        {(['jev', 'llm'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" checked={router === value} onChange={() => setRouter(value)} />
            {ROUTER_LABEL[value]}
          </label>
        ))}

        <label className="flex flex-col gap-1">
          Modelo
          <select value={model} onChange={(event) => setModel(event.target.value)} className={INPUT}>
            {unlisted && <option value={detail.store.llm_model}>{detail.store.llm_model} (fora da lista)</option>}
            {detail.models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-md bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {update.isSuccess && <span className="text-green-700">Salvo</span>}
          {update.isError && <span className="text-red-700">Não foi possível salvar.</span>}
        </div>
      </form>
    </Card>
  );
}

function MemoryCard({ storeId, hours }: { storeId: string; hours: number | null }) {
  const update = useUpdateAdminStore(storeId);
  const [value, setValue] = useState(hours === null ? '' : String(hours));
  const parsed = value.trim() === '' ? null : /^\d+$/.test(value.trim()) ? Number(value) : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (parsed !== undefined) {
      update.mutate({ order_memory_hours: parsed });
    }
  };

  return (
    <Card title="Memória do pedido">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <span>Pedido anterior conta por</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="numeric"
          placeholder="3"
          className={`${INPUT} w-20`}
        />
        <span>horas (vazio = padrão 3 h)</span>
        <button
          type="submit"
          disabled={update.isPending || parsed === undefined}
          className="rounded-md bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Salvar
        </button>
        {parsed === undefined && <span className="text-amber-700">Use um número inteiro.</span>}
        {update.isSuccess && <span className="text-green-700">Salvo</span>}
        {update.isError && <span className="text-red-700">Não foi possível salvar.</span>}
      </form>
    </Card>
  );
}

/**
 * What the store pays per order the AI took all the way; a handoff pays a share by AI progress (10 % to 85 %).
 */
function PriceCard({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const update = useUpdateAdminStore(storeId);
  const [value, setValue] = useState(detail.order_price_cents === null ? '' : centsToInput(detail.order_price_cents));
  const parsed = value.trim() === '' ? null : parseMoney(value);
  const [percent, setPercent] = useState(detail.web_order_percent === null ? '' : String(detail.web_order_percent));
  const parsedPercent = percent.trim() === '' ? null : /^\d{1,3}$/.test(percent.trim()) ? Number(percent) : undefined;
  const valid =
    (parsed === null || (parsed !== undefined && parsed <= 100_000)) &&
    (parsedPercent === null || (parsedPercent !== undefined && parsedPercent <= 100));

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (valid) {
      update.mutate({ order_price_cents: parsed ?? null, web_order_percent: parsedPercent ?? null });
    }
  };

  return (
    <Card title="Cobrança">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <span>Valor por pedido R$</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          placeholder={centsToInput(detail.default_order_price_cents)}
          className={`${INPUT} w-24`}
        />
        <span>(vazio = padrão {formatMoney(detail.default_order_price_cents)})</span>
        <span>Pedido pelo site</span>
        <input
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
          inputMode="numeric"
          placeholder={String(detail.default_web_order_percent)}
          className={`${INPUT} w-16`}
        />
        <span>% (vazio = padrão {detail.default_web_order_percent} %)</span>
        <button
          type="submit"
          disabled={update.isPending || !valid}
          className="rounded-md bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Salvar
        </button>
        {!valid && <span className="text-amber-700">Use um valor entre R$ 0 e R$ 1.000 e 0 a 100 %.</span>}
        {update.isSuccess && <span className="text-green-700">Salvo</span>}
        {update.isError && <span className="text-red-700">Não foi possível salvar.</span>}
      </form>
      <p className="mt-2 text-xs text-neutral-500">
        Pedido fechado pela IA = 100 %. Passado a um atendente: 10 % sem itens, 40 % com itens, +15 % por etapa
        (entrega/retirada, endereço, pagamento). Pedido pelo site = o percentual acima (inclui o código do WhatsApp).
        Falha nossa = 0 %. Arredonda para cima.
      </p>
    </Card>
  );
}

/**
 * Day 1 of next month (YYYY-MM-DD): the default date to test a cycle close.
 */
const nextMonthStart = () => {
  const today = new Date();

  return new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

/**
 * Card, open usage and invoices of the store, plus test actions that call Asaas for real (sandbox on dev).
 */
function PaymentCard({ storeId, billing }: { storeId: string; billing: BillingSummary }) {
  const run = useRunAdminBilling(storeId);
  const charge = useChargeAdminBillingNow(storeId);
  const [date, setDate] = useState(nextMonthStart);
  const nothingToCharge = charge.error instanceof ApiError && charge.error.status === 409;

  return (
    <Card title="Pagamento">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-neutral-500">Cartão</dt>
        <dd>{billing.card ? `${billing.card.brand} final ${billing.card.last4}` : 'nenhum'}</dd>
        <dt className="text-neutral-500">Bot bloqueado por falta de pagamento</dt>
        <dd className={billing.blocked ? 'font-medium text-red-700' : undefined}>{billing.blocked ? 'Sim' : 'Não'}</dd>
        <dt className="text-neutral-500">Em aberto (não faturado)</dt>
        <dd>
          {formatMoney(billing.open.amount_cents)} · {billing.open.orders} atendimentos
        </dd>
      </dl>

      {billing.invoices.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-100">
          {billing.invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
              <span>
                {invoice.period_start.slice(0, 7)} · {formatMoney(invoice.amount_cents)} · vence {invoice.due_date}
              </span>
              <span className={invoice.status === 'overdue' ? 'font-medium text-red-700' : 'text-neutral-600'}>
                {INVOICE_STATUS_LABEL[invoice.status]}
                {invoice.failure_reason && invoice.status !== 'paid' && ` (${invoice.failure_reason})`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={INPUT} />
        <button
          type="button"
          disabled={run.isPending || !date}
          onClick={() => run.mutate({ now: `${date}T12:00:00.000Z` })}
          className="rounded-md border border-neutral-300 px-3 py-2 disabled:opacity-50"
        >
          {run.isPending ? 'Rodando…' : 'Rodar cobrança nesta data'}
        </button>
        <button
          type="button"
          disabled={charge.isPending}
          onClick={() => charge.mutate()}
          className="rounded-md border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50"
        >
          {charge.isPending ? 'Cobrando…' : 'Cobrar fatura agendada hoje'}
        </button>
      </div>
      {run.isSuccess && <p className="mt-2 text-green-700">Cobrança rodada.</p>}
      {run.isError && <p className="mt-2 text-red-700">Não foi possível rodar.</p>}
      {charge.isSuccess && (
        <p className="mt-2 text-green-700">Vencimento movido para hoje; o webhook traz o resultado.</p>
      )}
      {nothingToCharge && <p className="mt-2 text-amber-700">Nenhuma fatura agendada no cartão.</p>}
      {charge.isError && !nothingToCharge && <p className="mt-2 text-red-700">Não foi possível cobrar.</p>}
      <p className="mt-2 text-xs text-neutral-500">
        Rodar numa data faz o job diário como se fosse 09:00 desse dia, só para esta loja: no dia 1 fecha o mês anterior
        (zera o em aberto). As duas ações chamam o Asaas de verdade: em produção cobram a loja.
      </p>
    </Card>
  );
}

function MenuCard({ storeId, activeProducts }: { storeId: string; activeProducts: number }) {
  const seed = useSeedDemoMenu(storeId);
  const [kind, setKind] = useState<DemoMenuKind>('pizzeria');
  const [confirming, setConfirming] = useState(false);
  const conflict = seed.error instanceof ApiError && seed.error.status === 409;
  const hasMenu = activeProducts > 0 || conflict;

  const load = (replace: boolean) => {
    setConfirming(false);
    seed.mutate({ kind, replace });
  };

  return (
    <Card title="Cardápio">
      <p className="text-neutral-600">{activeProducts} produtos ativos.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as DemoMenuKind);
            setConfirming(false);
          }}
          className={INPUT}
        >
          {Object.entries(DEMO_MENU_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {!hasMenu && (
          <button
            type="button"
            disabled={seed.isPending}
            onClick={() => load(false)}
            className="rounded-md border border-neutral-300 px-3 py-2 disabled:opacity-50"
          >
            Carregar cardápio demo
          </button>
        )}
        {hasMenu && !confirming && (
          <button
            type="button"
            disabled={seed.isPending}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50"
          >
            Substituir cardápio
          </button>
        )}
        <span className="text-xs text-neutral-500">Não mexe nos horários.</span>
      </div>
      {confirming && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-red-800">
            Apaga todas as categorias, produtos e opções desta loja e carrega o cardápio {DEMO_MENU_LABEL[kind]}.
            Pedidos já feitos não mudam.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={seed.isPending}
              onClick={() => load(true)}
              className="rounded-md bg-red-600 px-3 py-2 font-medium text-white disabled:opacity-50"
            >
              Apagar e substituir
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-neutral-300 px-3 py-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {seed.isSuccess && <p className="mt-2 text-green-700">{seed.data.products} produtos carregados.</p>}
      {conflict && (
        <p className="mt-2 text-amber-700">Esta loja já tem cardápio (talvez só inativo). Use Substituir.</p>
      )}
      {seed.isError && !conflict && <p className="mt-2 text-red-700">Não foi possível carregar.</p>}
    </Card>
  );
}

/**
 * How the store's orders are numbered from now on: 6 random symbols or 1, 2, 3… (old orders keep their code).
 */
function OrderCodeCard({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const update = useUpdateAdminStore(storeId);

  return (
    <Card title="Código do pedido">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={detail.order_code_mode}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ order_code_mode: event.target.value as 'random' | 'sequential' })}
          className={INPUT}
        >
          <option value="random">Aleatório (ex.: #K7Q2MX)</option>
          <option value="sequential">Sequencial (#1, #2, #3…)</option>
        </select>
        {update.isSuccess && <span className="text-green-700">Salvo</span>}
        {update.isError && <span className="text-red-700">Não foi possível salvar.</span>}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Vale para os próximos pedidos. O sequencial começa em 1 e, se voltar depois, continua de onde parou.
      </p>
    </Card>
  );
}
