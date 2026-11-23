import type { ReactNode } from 'react';
import type { Assumptions, CostReport } from '../lib/costs';

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { ApiError } from '../lib/api';
import { addDays, costComparison, loadAssumptions, parseDecimal, saveAssumptions, todayInSaoPaulo } from '../lib/costs';
import { handoffLabel } from '../lib/format';
import { useAdminStores, useCostReport } from '../lib/queries';

export const Route = createFileRoute('/admin/costs')({
  component: () => (
    <SignedIn>
      <CostsPage />
    </SignedIn>
  )
});

const INPUT = 'rounded-md border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none';

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const percent = (value: number) => `${value.toFixed(1).replace('.', ',')}%`;

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  jev: 'Jev',
  openrouter: 'OpenRouter'
};

const PATH_LABEL: Record<string, string> = {
  jev_direct: 'Jev decidiu sozinho',
  llm_fallback: 'Modelo completo (fallback)',
  llm_reply: 'Resposta após ação do Jev',
  transcription: 'Transcrição de áudio'
};

type Preset = 'today' | '7d' | '30d' | 'month';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'month', label: 'Este mês' }
];

const presetRange = (preset: Preset) => {
  const today = todayInSaoPaulo();

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
};

function CostsPage() {
  const stores = useAdminStores();
  const [storeId, setStoreId] = useState('');
  const [range, setRange] = useState(() => presetRange('30d'));
  const [assumptions, setAssumptions] = useState(loadAssumptions);
  const report = useCostReport({ storeId: storeId || undefined, ...range });
  const forbidden = report.error instanceof ApiError && report.error.status === 403;
  const badPeriod = report.error instanceof ApiError && report.error.field === 'period';

  const setAssumption = (key: keyof Assumptions, value: string) => {
    const next = { ...assumptions, [key]: value };

    setAssumptions(next);
    saveAssumptions(next);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Custos</h1>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            Loja
            <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className={INPUT}>
              <option value="">Todas</option>
              {stores.data?.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            De
            <input
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            Até
            <input
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
              className={INPUT}
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(presetRange(key))}
                className="rounded-md border border-line-2 px-3 py-2 hover:bg-hover"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <AssumptionInput label="Salário do atendente (R$/mês)" placeholder="2.500,00" value={assumptions.salary}>
            {(value) => setAssumption('salary', value)}
          </AssumptionInput>
          <AssumptionInput label="Encargos (%)" placeholder="70" value={assumptions.charges}>
            {(value) => setAssumption('charges', value)}
          </AssumptionInput>
          <AssumptionInput label="Câmbio (R$ por US$)" placeholder="5,40" value={assumptions.rate}>
            {(value) => setAssumption('rate', value)}
          </AssumptionInput>
          <AssumptionInput label="Infra fixa (R$/mês, opcional)" placeholder="0,00" value={assumptions.infra}>
            {(value) => setAssumption('infra', value)}
          </AssumptionInput>
          <AssumptionInput label="Código WhatsApp (R$ cada)" placeholder="0,035" value={assumptions.code}>
            {(value) => setAssumption('code', value)}
          </AssumptionInput>
        </div>
        <p className="text-xs text-muted">
          Datas no horário de São Paulo. Os valores acima ficam só neste navegador e não vão para o servidor.
        </p>
      </section>

      <div className="mt-4">
        {report.isPending && <Loading />}
        {forbidden && <p className="text-sm text-fg-2">Sem acesso.</p>}
        {badPeriod && (
          <p className="text-sm text-warn-fg">Período inválido: até 92 dias, com o fim depois do início.</p>
        )}
        {report.isError && !forbidden && !badPeriod && (
          <p className="text-sm text-danger-fg">Não foi possível carregar o relatório.</p>
        )}
        {report.data && <Report report={report.data} assumptions={assumptions} />}
      </div>
    </div>
  );
}

function AssumptionInput(props: {
  label: string;
  placeholder: string;
  value: string;
  children: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {props.label}
      <input
        value={props.value}
        onChange={(event) => props.children(event.target.value)}
        inputMode="decimal"
        placeholder={props.placeholder}
        className={`${INPUT} w-44`}
      />
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 text-sm">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Report({ report, assumptions }: { report: CostReport; assumptions: Assumptions }) {
  const { orders, ai } = report;
  const comparison = costComparison(report, assumptions);
  const served = report.conversations;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Comparação">
        {comparison.kind === 'missing' && <p className="text-fg-2">Informe o salário e o câmbio para comparar.</p>}
        {comparison.kind === 'invalid' && (
          <p className="text-warn-fg">{comparison.field}: valor inválido. Use números, como 2.500,00 ou 5,40.</p>
        )}
        {comparison.kind === 'no_orders' && <p className="text-fg-2">Sem pedidos no período.</p>}
        {comparison.kind === 'ok' && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted">IA por pedido</dt>
            <dd>{brl.format(comparison.aiPerOrderBrl)}</dd>
            <dt className="text-muted">Infra por pedido</dt>
            <dd>{brl.format(comparison.infraPerOrderBrl)}</dd>
            <dt className="font-medium">IA + infra por pedido</dt>
            <dd className="font-medium">{brl.format(comparison.aiPerOrderBrl + comparison.infraPerOrderBrl)}</dd>
            <dt className="font-medium">Atendente por pedido</dt>
            <dd className="font-medium">{brl.format(comparison.attendantPerOrderBrl)}</dd>
            <dt className="text-muted">Pedidos por mês (projeção)</dt>
            <dd>{integer.format(comparison.ordersPerMonth)}</dd>
            <dt className="font-medium">Economia</dt>
            <dd className={`font-semibold ${comparison.savingsPercent >= 0 ? 'text-ok-fg' : 'text-danger-fg'}`}>
              {percent(comparison.savingsPercent)}
            </dd>
          </dl>
        )}
      </Card>

      <Card title="Volume">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted">Período</dt>
          <dd>{report.period.days} dias</dd>
          <dt className="text-muted">Conversas atendidas</dt>
          <dd>{served}</dd>
          <dt className="text-muted">Pedidos</dt>
          <dd>
            {orders.placed}
            {orders.canceled > 0 && ` (${orders.canceled} cancelados)`}
          </dd>
          <dt className="text-muted">Conversão</dt>
          <dd>{served ? percent((orders.placed / served) * 100) : '—'}</dd>
        </dl>
        {report.handoffs.length > 0 && (
          <>
            <p className="mt-3 text-muted">Transferidas para atendente (motivo atual da conversa):</p>
            <ul className="mt-1">
              {report.handoffs.map(({ reason, count }) => (
                <li key={reason} className="flex justify-between">
                  <span>{handoffLabel(reason)}</span>
                  <span>{count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Cobrança">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted">Pedidos cobrados</dt>
          <dd>{report.billing.orders}</dd>
          <dt className="text-muted">Fechados pela IA</dt>
          <dd>{report.billing.placed}</dd>
          <dt className="text-muted">% médio cobrado</dt>
          <dd>{report.billing.average_percent === null ? '—' : `${report.billing.average_percent}%`}</dd>
          <dt className="font-medium">Total a cobrar</dt>
          <dd className="font-medium">{brl.format(report.billing.amount_cents / 100)}</dd>
        </dl>
      </Card>

      <WebOrdersCard report={report} codePrice={parseDecimal(assumptions.code)} />

      <Card title="IA">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted">Total</dt>
          <dd>{usd.format(ai.total_usd)}</dd>
          <dt className="text-muted">Por pedido</dt>
          <dd>{orders.placed ? usd.format(ai.total_usd / orders.placed) : '—'}</dd>
          <dt className="text-muted">Por conversa</dt>
          <dd>{served ? usd.format(ai.total_usd / served) : '—'}</dd>
          {ai.by_provider.map(({ provider, calls, cost_usd }) => (
            <Row key={provider} label={PROVIDER_LABEL[provider] ?? provider} calls={calls} cost={cost_usd} />
          ))}
        </dl>
      </Card>

      <Card title="Jev">
        {report.jev ? (
          <p>
            Decidiu sozinho em <strong>{percent((report.jev.direct / report.jev.turns) * 100)}</strong> dos{' '}
            {report.jev.turns} turnos em que foi usado.
          </p>
        ) : (
          <p className="text-fg-2">Nenhuma loja usou o Jev no período.</p>
        )}
      </Card>

      <div className="md:col-span-2">
        <Breakdown ai={ai} />
      </div>
    </div>
  );
}

type BreakdownKey = 'model' | 'path' | 'prompt';

const BREAKDOWNS: [BreakdownKey, string, string][] = [
  ['model', 'Modelo', 'Modelo'],
  ['path', 'Caminho', 'Caminho'],
  ['prompt', 'Prompt', 'Versão do prompt']
];

/**
 * AI calls of the period grouped by model, by path or by prompt version.
 */
function Breakdown({ ai }: { ai: CostReport['ai'] }) {
  const [key, setKey] = useState<BreakdownKey>('model');
  const rows =
    key === 'model'
      ? ai.by_model.map((row) => ({ ...row, label: row.model, mono: true }))
      : key === 'path'
        ? ai.by_path.map((row) => ({ ...row, label: PATH_LABEL[row.path] ?? row.path, mono: false }))
        : ai.by_prompt_version.map((row) => ({ ...row, label: row.version ?? 'sem versão', mono: true }));

  return (
    <section className="rounded-xl border border-line bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Por {BREAKDOWNS.find(([id]) => id === key)?.[1].toLowerCase()}</h2>
        <div className="inline-flex rounded-lg bg-surface-2 p-0.5 text-[13px] font-medium">
          {BREAKDOWNS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={key === id}
              onClick={() => setKey(id)}
              className={`rounded-md px-3 py-1 ${key === id ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">{BREAKDOWNS.find(([id]) => id === key)?.[2]}</th>
                <th className="py-1 pr-3 font-normal">Chamadas</th>
                <th className="py-1 pr-3 font-normal">Tokens (entrada / saída)</th>
                <th className="py-1 pr-3 font-normal">Custo</th>
                <th className="py-1 font-normal">Latência média</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-line">
                  <td className={`py-1 pr-3 ${row.mono ? 'font-mono text-xs' : ''}`}>{row.label}</td>
                  <td className="py-1 pr-3">{integer.format(row.calls)}</td>
                  <td className="py-1 pr-3">
                    {integer.format(row.input_tokens)} / {integer.format(row.output_tokens)}
                  </td>
                  <td className="py-1 pr-3">{usd.format(row.cost_usd)}</td>
                  <td className="py-1">{integer.format(row.avg_latency_ms)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-fg-2">Nenhuma chamada de IA no período.</p>
      )}
    </section>
  );
}

function Row({ label, calls, cost }: { label: string; calls: number; cost: number }) {
  return (
    <>
      <dt className="text-muted">
        {label} ({calls})
      </dt>
      <dd>{usd.format(cost)}</dd>
    </>
  );
}

/**
 * Public menu orders: every WhatsApp code sent is a Meta charge (verified or not); the margin is what the stores pay
 * for web orders minus those codes.
 */
function WebOrdersCard({ report, codePrice }: { report: CostReport; codePrice: number | undefined }) {
  const web = report.web_orders;
  const costCents = codePrice === undefined ? undefined : web.codes_sent * codePrice * 100;

  return (
    <Card title="Pedidos pelo site">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted">Códigos enviados</dt>
        <dd>{web.codes_sent}</dd>
        <dt className="text-muted">Entregues</dt>
        <dd>{web.codes_delivered}</dd>
        <dt className="text-muted">Falharam</dt>
        <dd className={web.codes_failed ? 'text-danger-fg' : undefined}>{web.codes_failed}</dd>
        <dt className="text-muted">Confirmados</dt>
        <dd>{web.codes_verified}</dd>
        <dt className="text-muted">Viraram pedido</dt>
        <dd>{web.codes_with_order}</dd>
        <dt className="text-muted">Pedidos cobrados</dt>
        <dd>{web.orders}</dd>
        <dt className="text-muted">Cobrado das lojas</dt>
        <dd>{brl.format(web.amount_cents / 100)}</dd>
        <dt className="text-muted">Custo WhatsApp</dt>
        <dd>{costCents === undefined ? '—' : brl.format(costCents / 100)}</dd>
        <dt className="font-medium">Margem</dt>
        <dd className="font-medium">
          {costCents === undefined ? '—' : brl.format((web.amount_cents - costCents) / 100)}
        </dd>
      </dl>
      {web.failures.length > 0 && (
        <>
          <p className="mt-3 text-muted">Motivos das falhas (WhatsApp):</p>
          <ul className="mt-1">
            {web.failures.map(({ reason, count }) => (
              <li key={reason} className="flex justify-between gap-3">
                <span className="break-all">{reason}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-muted">
        Custo = códigos enviados × preço por código (estimativa; o valor exato está no painel da Meta, por número, não
        por loja). Pedidos de quem já tinha o número confirmado não geram código.
      </p>
    </Card>
  );
}
