import type { FormEvent, ReactNode } from 'react';
import type { AdminStoreDetail, BillingSummary, DemoMenuKind, InvoiceStatus, RouterType } from '../lib/queries';
import type { StoreType } from '../lib/store-type';

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { SwitchCard, Toggle } from '../components/toggle';
import { WhatsAppConnect } from '../components/whatsapp-connect';
import { ApiError } from '../lib/api';
import { centsToInput, formatMoney, formatWhen, handoffLabel, parseMoney } from '../lib/format';
import {
  adminWhatsAppHooks,
  useAdminStaff,
  useAdminStore,
  useAdminUsers,
  useChargeAdminBillingNow,
  useResetAdminDemo,
  useResetAdminStaffPin,
  useRunAdminBilling,
  useSeedDemoMenu,
  useUpdateAdminStore
} from '../lib/queries';

type Tab = 'overview' | 'bot' | 'billing' | 'menu' | 'access';

const TABS: [Tab, string][] = [
  ['overview', 'Visão geral'],
  ['bot', 'Bot e mensagens'],
  ['billing', 'Cobrança'],
  ['menu', 'Cardápio demo'],
  ['access', 'WhatsApp e PIN']
];

const isTab = (value: unknown): value is Tab => TABS.some(([id]) => id === value);

export const Route = createFileRoute('/admin/$storeId')({
  validateSearch: (search: Record<string, unknown>): { section?: Tab } =>
    isTab(search.section) ? { section: search.section } : {},
  component: () => (
    <SignedIn>
      <AdminStorePage />
    </SignedIn>
  )
});

const INPUT = 'rounded-md border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none';

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
  japanese: 'Japonês',
  tobacco_liquor: 'Tabacaria e Adega',
  cosmetics: 'Cosméticos',
  beauty_studio: 'Estúdio de Beleza (serviços)'
};

function AdminStorePage() {
  const { storeId } = Route.useParams();
  const { section: tab = 'overview' } = Route.useSearch();
  const detail = useAdminStore(storeId);
  const forbidden = detail.error instanceof ApiError && detail.error.status === 403;
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-5">
        <Link to="/admin" className="text-sm text-muted hover:text-fg">
          ← Lojas
        </Link>
        {detail.data ? (
          <StoreHeader storeId={storeId} store={detail.data.store} />
        ) : (
          <h1 className="truncate text-xl font-semibold">Loja</h1>
        )}
      </header>

      {detail.isPending && <Loading />}
      {forbidden && <p className="text-sm text-fg-2">Sem acesso.</p>}
      {notFound && <p className="text-sm text-fg-2">Loja não encontrada.</p>}
      {detail.isError && !forbidden && !notFound && (
        <p className="text-sm text-danger-fg">Não foi possível carregar a loja.</p>
      )}

      {detail.data && (
        <>
          <nav className="mb-5 flex gap-5 overflow-x-auto border-b border-line">
            {TABS.map(([id, label]) => (
              <Link
                key={id}
                to="/admin/$storeId"
                params={{ storeId }}
                search={id === 'overview' ? {} : { section: id }}
                replace
                aria-current={tab === id ? 'page' : undefined}
                className={`-mb-px shrink-0 border-b-2 pb-2.5 text-sm whitespace-nowrap ${
                  tab === id
                    ? 'border-accent font-semibold text-fg'
                    : 'border-transparent font-medium text-muted hover:text-fg'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Sections key={storeId} storeId={storeId} detail={detail.data} tab={tab} />
        </>
      )}
    </div>
  );
}

const createdFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/**
 * Name, status, link and the activation switch (an inactive store's WhatsApp events are dropped).
 */
function StoreHeader({ storeId, store }: { storeId: string; store: AdminStoreDetail['store'] }) {
  const update = useUpdateAdminStore(storeId);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold">{store.name}</h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${store.active ? 'bg-ok-bg text-ok-fg' : 'bg-accepted-bg text-warn-fg'}`}
          >
            {store.active ? 'Ativa' : 'Pendente'}
          </span>
        </div>
        <p className="text-[13px] text-muted">
          /{store.slug} · criada {createdFormat.format(new Date(store.created_at))}
        </p>
      </div>
      <Link
        to="/panel/$slug"
        params={{ slug: store.slug }}
        target="_blank"
        className="text-sm font-medium text-accent-fg hover:text-accent-hover"
      >
        Abrir painel ↗
      </Link>
      <div className="flex items-center gap-2.5 text-sm">
        <Toggle
          checked={store.active}
          disabled={update.isPending}
          label="Loja ativa"
          onChange={(checked) => update.mutate({ active: checked })}
        />
        <span>{store.active ? 'Bot atendendo' : 'Bot ignorando o WhatsApp'}</span>
        {update.isError && <span className="text-danger-fg">Não foi possível alterar.</span>}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function Sections({ storeId, detail, tab }: { storeId: string; detail: AdminStoreDetail; tab: Tab }) {
  const whatsAppHooks = useMemo(() => adminWhatsAppHooks(storeId), [storeId]);

  switch (tab) {
    case 'overview':
      return (
        <Columns>
          <HealthCard detail={detail} />
          <>
            <DemoLinksCard storeId={storeId} slug={detail.store.slug} demoEnabled={detail.demo_enabled} />
            {detail.demo_enabled && <DemoResetCard storeId={storeId} slug={detail.store.slug} />}
          </>
        </Columns>
      );
    case 'bot':
      return (
        <Columns>
          <>
            <BotCard storeId={storeId} detail={detail} />
            <StoreTypeCard storeId={storeId} detail={detail} />
            <OrderCodeCard storeId={storeId} detail={detail} />
            <MemoryCard storeId={storeId} hours={detail.order_memory_hours} />
            <BotOptInCard storeId={storeId} detail={detail} />
          </>
          <WelcomeCard storeId={storeId} detail={detail} />
        </Columns>
      );
    case 'billing':
      return (
        <Columns>
          <PriceCard storeId={storeId} detail={detail} />
          {detail.billing && <PaymentCard storeId={storeId} billing={detail.billing} />}
        </Columns>
      );
    case 'menu':
      return <MenuCard storeId={storeId} activeProducts={detail.health.active_products} />;
    case 'access':
      return (
        <Columns>
          <div>
            <h2 className="mb-2 font-semibold">WhatsApp</h2>
            <WhatsAppConnect hooks={whatsAppHooks} />
            <p className="mt-2 text-sm text-muted">
              Última mensagem: {detail.health.last_message_at ? formatWhen(detail.health.last_message_at) : 'nenhuma'}
            </p>
          </div>
          <StaffPinCard storeId={storeId} />
        </Columns>
      );
  }
}

/**
 * Two columns on wide screens, one stack on phones.
 */
function Columns({ children: [left, right] }: { children: [ReactNode, ReactNode] }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">{left}</div>
      <div className="flex min-w-0 flex-col gap-4">{right}</div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <label className="flex flex-col gap-1.5 font-semibold">
      {label}
      <span className="flex gap-2">
        <input
          readOnly
          value={value}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line-2 bg-hover px-3 font-normal text-fg-2"
        />
        <button
          type="button"
          onClick={copy}
          className="h-11 rounded-lg border border-accent px-4 font-semibold text-accent-fg hover:bg-accent-soft"
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </span>
    </label>
  );
}

/**
 * Links to hand a prospect: the store panel and, when the demo is on, the fake phones.
 */
function DemoLinksCard({ storeId, slug, demoEnabled }: { storeId: string; slug: string; demoEnabled: boolean }) {
  const users = useAdminUsers();
  const members = users.data?.users.filter(({ stores }) => stores.some(({ id }) => id === storeId)) ?? [];
  const panel = `${window.location.origin}/panel/${slug}`;

  return (
    <Card title="Links para demo">
      <div className="flex flex-col gap-3">
        <CopyField label="Painel da loja" value={panel} />
        {demoEnabled && <CopyField label="Celulares de teste" value={`${panel}/phones`} />}
        <p className="text-fg-2">
          {users.isPending
            ? 'Carregando membros…'
            : members.length
              ? `Membros: ${members.map(({ email }) => email).join(', ')}.`
              : 'Nenhum membro ainda.'}{' '}
          <Link to="/admin/users" className="text-accent-fg hover:underline">
            Usuários
          </Link>
        </p>
      </div>
    </Card>
  );
}

/**
 * Wipes the store before another demo. Typing the slug confirms it: there is no undo.
 */
function DemoResetCard({ storeId, slug }: { storeId: string; slug: string }) {
  const reset = useResetAdminDemo(storeId);
  const [typed, setTyped] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (typed.trim() === slug) {
      reset.mutate(slug, { onSuccess: () => setTyped('') });
    }
  };

  return (
    <Card title="Zerar demo">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-fg-2">
          Apaga todas as conversas e mensagens, os pedidos do WhatsApp e do site (o estoque volta), as cobranças e os
          custos de IA dessas conversas e os clientes sem venda no PDV. Cardápio, estoque, PDV, caixa e configurações
          ficam. Não dá para desfazer.
        </p>
        <label className="flex flex-col gap-1.5">
          <span>
            Digite <b className="font-mono">{slug}</b> para confirmar
          </span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            className={INPUT}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={typed.trim() !== slug || reset.isPending}
            className="h-10 rounded-lg bg-danger px-4 font-semibold text-white hover:bg-danger-hover disabled:opacity-50"
          >
            {reset.isPending ? 'Zerando…' : 'Zerar demo'}
          </button>
          {reset.isSuccess && (
            <span className="text-ok-fg">
              Apagados: {reset.data.conversations} conversas, {reset.data.orders} pedidos, {reset.data.customers}{' '}
              clientes.
            </span>
          )}
          {reset.isError && <span className="text-danger-fg">Não foi possível zerar.</span>}
        </div>
      </form>
    </Card>
  );
}

function HealthCard({ detail }: { detail: AdminStoreDetail }) {
  const { health } = detail;

  return (
    <Card title="Saúde">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted">Aberta agora (horário)</dt>
        <dd>{health.open_now ? 'Sim' : 'Não'}</dd>
        <dt className="text-muted">Aceitando pedidos</dt>
        <dd>{health.accepting_orders ? 'Sim' : 'Não'}</dd>
        <dt className="text-muted">Produtos ativos</dt>
        <dd>{health.active_products}</dd>
        <dt className="text-muted">Última mensagem</dt>
        <dd>{health.last_message_at ? formatWhen(health.last_message_at) : 'nenhuma'}</dd>
        <dt className="text-muted">Erros nas últimas 24h</dt>
        <dd className={health.error_count24h ? 'font-medium text-danger-fg' : undefined}>{health.error_count24h}</dd>
        <dt className="text-muted">Pedidos nos últimos 30 dias</dt>
        <dd>{health.orders30d.toLocaleString('pt-BR')}</dd>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="font-medium">Erros recentes</span>
        <Link
          to="/admin/conversations"
          search={{ store: detail.store.id, show: 'errors' }}
          className="text-[13px] font-medium text-accent-fg hover:text-accent-hover"
        >
          Ver conversas com erro →
        </Link>
      </div>
      {health.recent_errors.length > 0 ? (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {health.recent_errors.map((error) => (
            <li key={error.conversation_id}>
              <Link
                to="/admin/conversations/$conversationId"
                params={{ conversationId: error.conversation_id }}
                search={{ store: detail.store.id, show: 'errors' }}
                className="flex justify-between gap-3 px-3 py-2 hover:bg-hover"
              >
                <span>{handoffLabel(error.reason)}</span>
                <span className="text-muted">{formatWhen(error.at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">Nenhum erro nas últimas 24h.</p>
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
            className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {update.isSuccess && <span className="text-ok-fg">Salvo</span>}
          {update.isError && <span className="text-danger-fg">Não foi possível salvar.</span>}
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
          className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Salvar
        </button>
        {parsed === undefined && <span className="text-warn-fg">Use um número inteiro.</span>}
        {update.isSuccess && <span className="text-ok-fg">Salvo</span>}
        {update.isError && <span className="text-danger-fg">Não foi possível salvar.</span>}
      </form>
    </Card>
  );
}

/**
 * What the store pays per order the AI took all the way; a handoff pays a share by AI progress (10 % to 85 %).
 */
/**
 * Percent billed per outcome (`billing/progress.ts`, `REDIRECT_PERCENT`); the web percent is per store.
 */
const BILLING_STEPS = [
  ['Pedido fechado pela IA', 100],
  ['Passado com itens e as 3 etapas', 85],
  ['Passado com itens e 2 etapas', 70],
  ['Passado com itens e 1 etapa', 55],
  ['Passado com itens', 40],
  ['Passado sem itens', 10],
  ['Link de direcionamento enviado', 10]
] as const;

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
          className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Salvar
        </button>
        {!valid && <span className="text-warn-fg">Use um valor entre R$ 0 e R$ 1.000 e 0 a 100 %.</span>}
        {update.isSuccess && <span className="text-ok-fg">Salvo</span>}
        {update.isError && <span className="text-danger-fg">Não foi possível salvar.</span>}
      </form>
      <div className="mt-4 rounded-lg border border-line">
        <p className="border-b border-line px-3 py-2 text-xs font-medium text-muted">Quanto cada atendimento paga</p>
        <ul className="px-3 py-1">
          {[
            ...BILLING_STEPS,
            [
              'Pedido pelo site (inclui o código do WhatsApp)',
              parsedPercent ?? detail.default_web_order_percent
            ] as const
          ].map(([label, stepPercent]) => (
            <li key={label} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                {label} · {stepPercent ?? '—'} %
              </span>
              <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-2 sm:block">
                <span className="block h-full bg-accent" style={{ width: `${Math.min(stepPercent ?? 0, 100)}%` }} />
              </span>
              <span className="w-20 text-right font-medium tabular-nums">
                {valid && stepPercent !== undefined
                  ? formatMoney(Math.ceil(((parsed ?? detail.default_order_price_cents) * stepPercent) / 100))
                  : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-xs text-muted">
        Passado a um atendente: 10 % sem itens, 40 % com itens, +15 % por etapa (entrega/retirada, endereço, pagamento).
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
        <dt className="text-muted">Cartão</dt>
        <dd>{billing.card ? `${billing.card.brand} final ${billing.card.last4}` : 'nenhum'}</dd>
        <dt className="text-muted">Bot bloqueado por falta de pagamento</dt>
        <dd className={billing.blocked ? 'font-medium text-danger-fg' : undefined}>
          {billing.blocked ? 'Sim' : 'Não'}
        </dd>
        <dt className="text-muted">Em aberto (não faturado)</dt>
        <dd>
          {formatMoney(billing.open.amount_cents)} · {billing.open.orders} atendimentos
        </dd>
      </dl>

      {billing.invoices.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {billing.invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
              <span>
                {invoice.period_start.slice(0, 7)} · {invoice.store_name} · {formatMoney(invoice.amount_cents)} · vence{' '}
                {invoice.due_date}
              </span>
              <span className={invoice.status === 'overdue' ? 'font-medium text-danger-fg' : 'text-fg-2'}>
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
          className="rounded-md border border-line-2 px-3 py-2 disabled:opacity-50"
        >
          {run.isPending ? 'Rodando…' : 'Rodar cobrança nesta data'}
        </button>
        <button
          type="button"
          disabled={charge.isPending}
          onClick={() => charge.mutate()}
          className="rounded-md border border-danger-line px-3 py-2 text-danger-fg disabled:opacity-50"
        >
          {charge.isPending ? 'Cobrando…' : 'Cobrar fatura agendada hoje'}
        </button>
      </div>
      {run.isSuccess && <p className="mt-2 text-ok-fg">Cobrança rodada.</p>}
      {run.isError && <p className="mt-2 text-danger-fg">Não foi possível rodar.</p>}
      {charge.isSuccess && <p className="mt-2 text-ok-fg">Vencimento movido para hoje; o webhook traz o resultado.</p>}
      {nothingToCharge && <p className="mt-2 text-warn-fg">Nenhuma fatura agendada no cartão.</p>}
      {charge.isError && !nothingToCharge && <p className="mt-2 text-danger-fg">Não foi possível cobrar.</p>}
      <p className="mt-2 text-xs text-muted">
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
      <p className="text-fg-2">{activeProducts} produtos ativos.</p>
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
            className="rounded-md border border-line-2 px-3 py-2 disabled:opacity-50"
          >
            Carregar cardápio demo
          </button>
        )}
        {hasMenu && !confirming && (
          <button
            type="button"
            disabled={seed.isPending}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-danger-line px-3 py-2 text-danger-fg disabled:opacity-50"
          >
            Substituir cardápio
          </button>
        )}
        <span className="text-xs text-muted">Não mexe nos horários.</span>
      </div>
      {confirming && (
        <div className="mt-3 rounded-md border border-danger-line bg-danger-soft p-3">
          <p className="text-danger-fg">
            Apaga todas as categorias, produtos e opções desta loja e carrega o cardápio {DEMO_MENU_LABEL[kind]}.
            Pedidos já feitos não mudam.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={seed.isPending}
              onClick={() => load(true)}
              className="rounded-md bg-danger px-3 py-2 font-medium text-white disabled:opacity-50"
            >
              Apagar e substituir
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-line-2 px-3 py-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {seed.isSuccess && <p className="mt-2 text-ok-fg">{seed.data.products} produtos carregados.</p>}
      {conflict && <p className="mt-2 text-warn-fg">Esta loja já tem cardápio (talvez só inativo). Use Substituir.</p>}
      {seed.isError && !conflict && <p className="mt-2 text-danger-fg">Não foi possível carregar.</p>}
    </Card>
  );
}

/**
 * How the store's orders are numbered from now on: 6 random symbols or 1, 2, 3… (old orders keep their code).
 */
/**
 * How the bot, its fixed messages and the public page talk: restaurant menu or shop catalog.
 */
function StoreTypeCard({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const update = useUpdateAdminStore(storeId);

  return (
    <Card title="Tipo de loja">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={detail.store_type}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ store_type: event.target.value as StoreType })}
          className={INPUT}
        >
          <option value="food">Alimentação (cardápio)</option>
          <option value="retail">Produtos (catálogo)</option>
        </select>
        {update.isSuccess && <span className="text-ok-fg">Salvo</span>}
        {update.isError && <span className="text-danger-fg">Não foi possível salvar.</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        Muda o jeito do bot (catálogo, sugestões de produtos), a saudação, as mensagens de status e a página pública.
        Popular o cardápio demo Cosméticos ou Tabacaria já marca Produtos.
      </p>
    </Card>
  );
}

/**
 * For a store that also offers a service in another system (e.g. bookings): its own plain-hello welcome and the link
 * the bot sends. Empty fields go back to the default.
 */
function BotOptInCard({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const update = useUpdateAdminStore(storeId);

  return (
    <Card title="Rollout do bot">
      <SwitchCard
        checked={detail.bot_opt_in}
        disabled={update.isPending}
        title="Bot só atende as conversas que a loja passar para ele"
        description="Conversas novas começam com atendente."
        onChange={(checked) => update.mutate({ bot_opt_in: checked })}
      />
      {update.isError && <p className="mt-2 text-danger-fg">Não foi possível salvar.</p>}
    </Card>
  );
}

function WelcomeCard({ storeId, detail }: { storeId: string; detail: AdminStoreDetail }) {
  const update = useUpdateAdminStore(storeId);
  const [welcome, setWelcome] = useState(detail.welcome_text ?? '');
  const [label, setLabel] = useState(detail.redirect?.label ?? '');
  const [url, setUrl] = useState(detail.redirect?.url ?? '');
  const [redirectOnly, setRedirectOnly] = useState(detail.redirect_only);
  const half = !label.trim() !== !url.trim();
  const badUrl = !!url.trim() && !/^https?:\/\/\S+$/i.test(url.trim());
  const noLink = redirectOnly && !url.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (half || badUrl || noLink) {
      return;
    }

    update.mutate({
      welcome_text: welcome.trim() || null,
      redirect: url.trim() ? { label: label.trim(), url: url.trim() } : null,
      redirect_only: redirectOnly
    });
  };

  return (
    <Card title="Boas-vindas e link de direcionamento">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span>
            {redirectOnly
              ? 'Mensagem de boas-vindas (toda nova visita; vazia = o link)'
              : 'Mensagem de boas-vindas (cliente novo que só disse oi)'}
          </span>
          <textarea
            value={welcome}
            onChange={(event) => setWelcome(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder={'Como posso te ajudar?\n1️⃣ Comprar produtos\n2️⃣ Agendar horário'}
            className={INPUT}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span>Nome do link</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={60}
              placeholder="Agendamento"
              className={`${INPUT} w-48`}
            />
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1">
            <span>URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={500}
              inputMode="url"
              placeholder="https://…"
              className={INPUT}
            />
          </label>
        </div>
        <SwitchCard
          checked={redirectOnly}
          title="Loja só de direcionamento"
          description="Não vende: manda o link e tira dúvidas do catálogo."
          onChange={setRedirectOnly}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={update.isPending || half || badUrl || noLink}
            className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {half && <span className="text-warn-fg">Preencha nome e URL do link, ou deixe os dois vazios.</span>}
          {badUrl && <span className="text-warn-fg">A URL começa com https://</span>}
          {noLink && <span className="text-warn-fg">A loja de direcionamento precisa do link.</span>}
          {update.isSuccess && <span className="text-ok-fg">Salvo</span>}
          {update.isError && <span className="text-danger-fg">Não foi possível salvar.</span>}
        </div>
      </form>
      <WelcomePreview
        detail={detail}
        welcome={welcome}
        redirect={url.trim() && !half && !badUrl ? { label: label.trim(), url: url.trim() } : null}
        redirectOnly={redirectOnly}
      />
      <p className="mt-2 text-xs text-muted">
        A mensagem troca a do link do {detail.store_type === 'retail' ? 'catálogo' : 'cardápio'} na saudação de quem só
        disse oi (vazia = padrão). O bot manda o link quando o cliente quer esse serviço; cada ciclo em que ele manda
        cobra 10 % do preço por pedido (a saudação nunca cobra).
      </p>
      <p className="mt-1 text-xs text-muted">
        Loja só de direcionamento: responde a qualquer hora, a primeira mensagem de cada visita é fixa (sem IA) e as
        seguintes usam a IA com o SOP da loja e o catálogo, sem montar pedidos. Cada visita com o link cobra 10 %.
      </p>
    </Card>
  );
}

/**
 * "Bom dia", "Boa tarde" or "Boa noite" now in São Paulo (the API uses the store timezone).
 */
const periodNow = () => {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(
      new Date()
    )
  );

  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
};

/**
 * What a new customer who says "oi" gets, with the unsaved form values. Mirrors `buildGreeting` and
 * `buildRedirectWelcome` (`api/src/conversations/greeting.ts`): change both together.
 */
function WelcomePreview({
  detail,
  welcome,
  redirect,
  redirectOnly
}: {
  detail: AdminStoreDetail;
  welcome: string;
  redirect: { label: string; url: string } | null;
  redirectOnly: boolean;
}) {
  const hello = `${periodNow()}, Maria! 👋`;
  const store = `*${detail.store.name.replace(/\*/g, '').trim()}*`;
  const messages = redirectOnly
    ? [
        `${hello} Este é o atendimento da loja ${store} 😊`,
        welcome.trim() ||
          (redirect &&
            `👉 *${redirect.label.replace(/\*/g, '')}*: é só usar o link abaixo\n${redirect.url}\n\nSe tiver alguma dúvida, é só perguntar por aqui 💬`)
      ]
    : [
        hello,
        `Seja bem-vindo(a)! Este é o atendimento da loja ${store} 😊\nSou o atendente virtual 🤖 e posso montar seu pedido por aqui.`,
        welcome.trim() ||
          [
            'Vi que é sua primeira vez com a gente, que bom te ver por aqui! ✨',
            `Se preferir, nosso ${detail.store_type === 'retail' ? 'catálogo' : 'cardápio'} completo está aqui e dá para pedir direto por ele 👇`,
            `${window.location.origin}/${detail.store.slug}`,
            '',
            'Ou é só me dizer o que vai querer 💬 E se quiser falar com um atendente, é só pedir 🙋'
          ].join('\n')
      ];

  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-medium text-muted">Prévia: cliente novo diz “oi”</p>
      <div className="flex flex-col gap-1.5 rounded-lg bg-chat p-3">
        <span className="self-start rounded-lg bg-bubble-in px-2.5 py-1.5 shadow-sm">oi</span>
        {messages.filter(Boolean).map((text, index) => (
          <span
            key={index}
            className="max-w-[85%] self-end rounded-lg bg-bubble-out px-2.5 py-1.5 break-words whitespace-pre-wrap shadow-sm"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

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
        {update.isSuccess && <span className="text-ok-fg">Salvo</span>}
        {update.isError && <span className="text-danger-fg">Não foi possível salvar.</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        Vale para os próximos pedidos. O sequencial começa em 1 e, se voltar depois, continua de onde parou.
      </p>
    </Card>
  );
}

/**
 * Fallback for a store locked out by a forgotten PIN: the admin sets a new one for a PIN employee.
 */
function StaffPinCard({ storeId }: { storeId: string }) {
  const staff = useAdminStaff(storeId);
  const reset = useResetAdminStaffPin(storeId);
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const people = staff.data?.staff.filter(({ role }) => role !== 'courier') ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (staffId && /^\d{4}$/.test(pin)) {
      reset.mutate({ staff_id: staffId, pin }, { onSuccess: () => setPin('') });
    }
  };

  return (
    <Card title="Redefinir PIN">
      {people.length === 0 ? (
        <p className="text-sm text-muted">Nenhum funcionário com PIN.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <select
            value={staffId}
            onChange={(event) => {
              setStaffId(event.target.value);
              reset.reset();
            }}
            className={INPUT}
          >
            <option value="">Escolha quem</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} ({person.role}
                {person.active ? '' : ', inativo'})
              </option>
            ))}
          </select>
          <input
            value={pin}
            inputMode="numeric"
            maxLength={4}
            placeholder="Novo PIN"
            autoComplete="off"
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, ''));
              reset.reset();
            }}
            className={`w-28 ${INPUT}`}
          />
          <button
            type="submit"
            disabled={reset.isPending || !staffId || pin.length !== 4}
            className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Redefinir
          </button>
          {reset.isSuccess && <span className="text-ok-fg">PIN trocado</span>}
          {reset.isError && <span className="text-danger-fg">Não foi possível trocar.</span>}
        </form>
      )}
    </Card>
  );
}
