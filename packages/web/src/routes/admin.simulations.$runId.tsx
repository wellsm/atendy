import type { SimulationResult, SimulationStatus } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { formatMoney, formatWhen } from '../lib/format';
import { useSimulationRun } from '../lib/queries';

export const Route = createFileRoute('/admin/simulations/$runId')({
  component: () => (
    <SignedIn>
      <RunPage />
    </SignedIn>
  )
});

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

const STATUS: Record<SimulationStatus, { label: string; className: string }> = {
  running: { label: 'Rodando', className: 'bg-neutral-100 text-neutral-700' },
  passed: { label: 'Passou', className: 'bg-green-100 text-green-800' },
  failed: { label: 'Falhou', className: 'bg-red-100 text-red-800' },
  error: { label: 'Erro', className: 'bg-amber-100 text-amber-800' }
};

const ERRORS: Record<string, string> = {
  no_reply: 'O bot não respondeu em 5 minutos.'
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const outcomeOf = (simulation: SimulationResult) =>
  simulation.checks.find(({ name }) => name === 'outcome')?.actual ?? null;

function RunPage() {
  const { runId } = Route.useParams();
  const query = useSimulationRun(runId);

  if (query.isPending) {
    return <Loading />;
  }

  if (query.isError) {
    return <p className="p-6 text-sm text-red-700">Não foi possível carregar a rodada.</p>;
  }

  const { run, simulations } = query.data;
  const count = (status: SimulationStatus) => simulations.filter((simulation) => simulation.status === status).length;
  const placed = simulations.filter((simulation) => outcomeOf(simulation) === 'placed').length;
  const handoffs = simulations.filter((simulation) => outcomeOf(simulation) === 'handoff').length;
  const botCost = sum(simulations.map(({ bot_cost_usd }) => bot_cost_usd));
  const testCost = sum(simulations.map(({ customer_cost_usd, judge_cost_usd }) => customer_cost_usd + judge_cost_usd));
  const billing = sum(simulations.map(({ billing_cents }) => billing_cents));

  const totals: [string, string][] = [
    [
      'Resultado',
      `${count('passed')} ok · ${count('failed')} falharam · ${count('error')} erro · ${count('running')} rodando`
    ],
    ['Custo do bot', usd.format(botCost)],
    ['Bot por pedido fechado', placed ? usd.format(botCost / placed) : '—'],
    ['Bot por conversa', simulations.length ? usd.format(botCost / simulations.length) : '—'],
    ['Pedidos / handoffs', `${placed} / ${handoffs}`],
    ['Cobrança gerada', formatMoney(billing)],
    ['Custo do teste (cliente + juiz)', usd.format(testCost)]
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/simulations" className="text-sm text-neutral-500">
            ← Simulações
          </Link>
          <h1 className="truncate text-xl font-semibold">{run.name}</h1>
          <p className="text-sm text-neutral-600">
            {run.store_name} · {run.router} · {run.llm_model} · prompt {run.prompt_version} · cliente{' '}
            {run.customer_model} · {formatWhen(run.created_at)}
            {!run.finished_at && ' · rodando…'}
          </p>
        </div>
        <UserButton />
      </header>

      <dl className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-2 md:grid-cols-3">
        {totals.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-neutral-500">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-3">
        {simulations.map((simulation) => (
          <li key={simulation.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{simulation.title}</span>{' '}
                <code className="font-mono text-xs text-neutral-500">
                  {simulation.scenario_id}
                  {simulation.repeat_index > 0 && ` #${simulation.repeat_index + 1}`}
                </code>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[simulation.status].className}`}>
                {STATUS[simulation.status].label}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
              <span>{simulation.turns} falas do cliente</span>
              <span>
                {simulation.ai_calls} chamadas · {usd.format(simulation.bot_cost_usd)}
              </span>
              {simulation.billing_percent !== null && (
                <span>
                  cobrança {simulation.billing_percent}% · {formatMoney(simulation.billing_cents)}
                </span>
              )}
              {simulation.conversation_id && (
                <Link
                  to="/admin/conversations/$conversationId"
                  params={{ conversationId: simulation.conversation_id }}
                  className="font-medium text-accent-fg hover:text-accent-hover"
                >
                  Ver conversa →
                </Link>
              )}
            </div>

            {simulation.error && (
              <p className="mt-2 text-sm text-amber-800">{ERRORS[simulation.error] ?? simulation.error}</p>
            )}

            {simulation.checks.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {simulation.checks.map((check, index) => (
                  <li key={`${check.name}-${index}`} className="flex gap-2">
                    <span className={check.pass ? 'text-green-700' : 'text-red-700'}>{check.pass ? '✓' : '✗'}</span>
                    <span className="min-w-0 break-words">
                      <span className="font-mono text-xs text-neutral-500">{check.name}</span> {check.expected}
                      {!check.pass && <span className="text-red-700"> → {check.actual}</span>}
                      {check.pass && check.name === 'judge' && (
                        <span className="text-neutral-500"> ({check.actual})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
