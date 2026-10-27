import { UserButton } from '@clerk/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { ApiError } from '../lib/api';
import { formatWhen } from '../lib/format';
import { useAdminStores, useSimulationRuns, useStartSimulation, useValidateScenarios } from '../lib/queries';

export const Route = createFileRoute('/admin/simulations/')({
  component: () => (
    <SignedIn>
      <SimulationsPage />
    </SignedIn>
  )
});

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';

const DRAFT_KEY = 'atendy.simulation-draft';

/**
 * Last scenario file typed in this browser, so a new run after a change starts from it.
 */
const loadDraft = () => {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
};

const saveDraft = (source: string) => {
  try {
    localStorage.setItem(DRAFT_KEY, source);
  } catch {
    // Not remembered; the page keeps working.
  }
};

function SimulationsPage() {
  const stores = useAdminStores();
  const runs = useSimulationRuns();
  const validate = useValidateScenarios();
  const start = useStartSimulation();
  const navigate = useNavigate();

  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState('');
  // Empty = the API default (first of `customer_models`).
  const [customerModel, setCustomerModel] = useState('');
  const [source, setSource] = useState(loadDraft);
  const [validated, setValidated] = useState<string | null>(null);

  const result = validate.data;
  const valid = !!result && !result.errors.length && validated === source;
  const total = result?.scenarios.reduce((sum, { repeat }) => sum + repeat, 0) ?? 0;

  const onValidate = () => {
    saveDraft(source);
    validate.mutate(source, { onSuccess: () => setValidated(source) });
  };

  const onStart = () => {
    start.mutate(
      { storeId, name, source, customerModel },
      {
        onSuccess: ({ run_id }) => void navigate({ to: '/admin/simulations/$runId', params: { runId: run_id } })
      }
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-sm text-neutral-500">
            ← Lojas
          </Link>
          <h1 className="text-xl font-semibold">Simulações</h1>
          <p className="text-sm text-neutral-600">
            Clientes simulados conversam com o bot de verdade (fila, ferramentas, pedidos), sem WhatsApp.
          </p>
        </div>
        <UserButton />
      </header>

      <section className="mb-8 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className={INPUT}>
            <option value="">Escolha a loja</option>
            {stores.data?.stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
          <select
            value={customerModel}
            onChange={(event) => setCustomerModel(event.target.value)}
            aria-label="Modelo do cliente simulado"
            className={INPUT}
          >
            {runs.data?.customer_models.map((model, index) => (
              <option key={model} value={index ? model : ''}>
                Cliente: {model}
                {!index && ' (padrão)'}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome da rodada (opcional)"
            className={`${INPUT} min-w-0 flex-1`}
          />
        </div>

        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          rows={18}
          placeholder="Cole os cenários (YAML ou JSON). Modelo: docs/specs/simulation-scenarios.yaml"
          className={`${INPUT} font-mono text-xs`}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!source.trim() || validate.isPending}
            onClick={onValidate}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {validate.isPending ? 'Validando…' : 'Validar'}
          </button>
          <button
            type="button"
            disabled={!valid || !storeId || start.isPending}
            onClick={onStart}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {start.isPending ? 'Iniciando…' : `Rodar ${total || ''} conversas`}
          </button>
          {result && validated !== source && (
            <span className="text-sm text-amber-700">Valide de novo após editar.</span>
          )}
          {validate.isError && <span className="text-sm text-red-700">Não foi possível validar.</span>}
          {start.isError && (
            <span className="text-sm text-red-700">
              {start.error instanceof ApiError && start.error.status === 400
                ? 'Cenários inválidos.'
                : 'Não foi possível iniciar.'}
            </span>
          )}
        </div>

        {result && result.errors.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md bg-red-50 p-3 text-sm text-red-800">
            {result.errors.map((error) => (
              <li key={`${error.path}-${error.message}`}>
                <code className="font-mono text-xs">{error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        )}

        {result && !result.errors.length && (
          <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm">
            {result.scenarios.map((scenario) => (
              <li key={scenario.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{scenario.title}</span>{' '}
                  <code className="font-mono text-xs text-neutral-500">{scenario.id}</code>
                </span>
                <span className="text-xs text-neutral-500">
                  {scenario.scripted ? 'roteiro fixo' : 'cliente IA'} · até {scenario.max_turns} falas
                  {scenario.repeat > 1 && ` · ${scenario.repeat}×`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mb-3 text-lg font-semibold">Rodadas</h2>

      {runs.isPending && <Loading />}
      {runs.isError && <p className="text-sm text-red-700">Não foi possível carregar as rodadas.</p>}
      {runs.isSuccess && !runs.data.runs.length && <p className="text-sm text-neutral-600">Nenhuma rodada ainda.</p>}

      {runs.isSuccess && runs.data.runs.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {runs.data.runs.map((run) => (
            <li key={run.id}>
              <Link
                to="/admin/simulations/$runId"
                params={{ runId: run.id }}
                className="flex flex-col gap-1 p-4 hover:bg-neutral-50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{run.name}</span>
                  <span className="text-neutral-500">{formatWhen(run.created_at)}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                  <span>{run.store_name}</span>
                  <span>
                    {run.router} · {run.llm_model} · prompt {run.prompt_version} · cliente {run.customer_model}
                  </span>
                  <span className="text-green-700">{run.passed} ok</span>
                  {run.failed > 0 && <span className="text-red-700">{run.failed} falharam</span>}
                  {run.errors > 0 && <span className="text-amber-700">{run.errors} com erro</span>}
                  {run.running > 0 && <span>{run.running} rodando</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
