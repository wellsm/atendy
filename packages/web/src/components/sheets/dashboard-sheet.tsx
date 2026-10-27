import type { Dashboard, OrderStep } from '../../lib/queries';

import { useState } from 'react';

import { Sheet, SheetHeader } from './sheet';
import { formatMoney, handoffLabel } from '../../lib/format';
import { useDashboard } from '../../lib/queries';
import { Loading } from '../loading';

export const STEP_LABEL: Record<'conversation' | OrderStep, string> = {
  conversation: 'Conversou',
  items: 'Itens',
  fulfillment: 'Entrega/retirada',
  address: 'Endereço',
  payment: 'Pagamento',
  placed: 'Pedido fechado'
};

const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Brazil's current month (YYYY-MM), like the billing cycle (UTC−3).
 */
const currentMonth = () => new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 7);

const shiftMonth = (month: string, offset: number) => {
  const [year, index] = month.split('-').map(Number) as [number, number];

  return new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 7);
};

const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

/**
 * The billing month: conversations, how far they got, how they ended, orders and Atendy cost per day.
 */
export function DashboardSheet({ onClose }: { onClose: () => void }) {
  const [month, setMonth] = useState(currentMonth);
  const dashboard = useDashboard(month);
  const latest = month >= currentMonth();

  return (
    <Sheet width="lg" label="Desempenho" onClose={onClose}>
      <SheetHeader title="Desempenho" subtitle="Mês da fatura: atendimentos, etapas e custo Atendy." onClose={onClose}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex size-8 items-center justify-center rounded-lg text-fg-2 hover:bg-hover"
          >
            ‹
          </button>
          <span className="min-w-32 text-center text-sm font-medium capitalize">
            {MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`))}
          </span>
          <button
            type="button"
            aria-label="Próximo mês"
            disabled={latest}
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex size-8 items-center justify-center rounded-lg text-fg-2 hover:bg-hover disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {dashboard.isPending && <Loading />}

        {dashboard.isError && <p className="text-sm text-accent-fg">Não foi possível carregar o desempenho.</p>}

        {dashboard.data && <DashboardBody data={dashboard.data} />}
      </div>
    </Sheet>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-3.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[22px] font-bold tracking-tight">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const { totals } = data;

  const outcomes = [
    { label: 'Fechado pelo bot', count: totals.placed_by_bot, tone: 'bg-on' },
    { label: 'Foi para atendente', count: totals.handoffs, tone: 'bg-accent' },
    { label: 'Abandonado', count: totals.abandoned, tone: 'bg-faint' },
    { label: 'Falha nossa (sem custo)', count: totals.failures, tone: 'bg-warn-fg' }
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label="Atendimentos" value={String(totals.conversations)} />
        <Stat
          label="Pedidos fechados"
          value={String(totals.placed_by_bot + totals.placed_by_store + totals.placed_by_web)}
          hint={`${totals.placed_by_bot} pelo bot · ${totals.placed_by_web} pelo site · ${totals.placed_by_store} pela loja`}
        />
        <Stat
          label="Custo Atendy"
          value={formatMoney(totals.cost_cents)}
          hint={totals.forecast_cents != null ? `Previsão ${formatMoney(totals.forecast_cents)}` : undefined}
        />
        <Stat
          label="Custo por pedido"
          value={totals.cost_per_order_cents != null ? formatMoney(totals.cost_per_order_cents) : '—'}
          hint={`Preço cheio ${formatMoney(data.price_cents)}`}
        />
      </div>

      <Days data={data} />

      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2.5">
          <h3 className="text-sm font-semibold">Até onde chegaram</h3>
          {data.funnel.map(({ step, count }) => (
            <div key={step} className="flex flex-col gap-1">
              <div className="flex justify-between text-[13px]">
                <span>{STEP_LABEL[step]}</span>
                <span className="text-muted">
                  {count} · {percent(count, totals.conversations)}%
                </span>
              </div>
              <span className="block h-2 overflow-hidden rounded bg-surface-2">
                <span
                  className="block h-full rounded bg-accent"
                  style={{ width: `${percent(count, totals.conversations)}%` }}
                />
              </span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-sm font-semibold">Como terminaram</h3>
          {outcomes.map(({ label, count, tone }) => (
            <div key={label} className="flex items-center gap-2 text-[13px]">
              <span className={`size-2 shrink-0 rounded-full ${tone}`} />
              <span className="flex-1">{label}</span>
              <span className="text-muted">
                {count} · {percent(count, totals.conversations)}%
              </span>
            </div>
          ))}
          <span className="text-xs text-muted">
            {`Pedidos que a loja fechou sozinha (${totals.placed_by_store}, sem custo) e pedidos pelo site (${totals.placed_by_web}) não entram nos atendimentos.`}
          </span>

          {data.handoff_reasons.length > 0 && (
            <>
              <h3 className="mt-2 text-sm font-semibold">Motivos para o atendente</h3>
              {data.handoff_reasons.map(({ reason, count }) => (
                <div key={reason} className="flex justify-between text-[13px]">
                  <span>{handoffLabel(reason)}</span>
                  <span className="text-muted">{count}</span>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Orders per day as bars; each bar's title has the day's conversations and cost.
 */
function Days({ data }: { data: Dashboard }) {
  const max = Math.max(1, ...data.days.map(({ orders }) => orders));

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Pedidos por dia</h3>
        <span className="text-xs text-muted">Passe o mouse para ver atendimentos e custo</span>
      </div>
      <div className="flex h-32 items-end gap-[3px]">
        {data.days.map((day) => (
          <div
            key={day.date}
            title={`${day.date.slice(8)}/${day.date.slice(5, 7)}: ${day.orders} pedidos · ${day.conversations} atendimentos · ${formatMoney(day.cost_cents)}`}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <span
              className={`block rounded-t ${day.orders ? 'bg-accent' : 'bg-line'}`}
              style={{ height: day.orders ? `${(day.orders / max) * 100}%` : '2px' }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-faint">
        <span>1</span>
        <span>{data.days.length}</span>
      </div>
    </section>
  );
}
