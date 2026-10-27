import type { AdminAiCall, AdminConversationDetail, AdminMessage, ConversationSimulation } from '../lib/queries';

import { UserButton } from '@clerk/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { MessageBody } from '../components/conversations/message-body';
import { Loading } from '../components/loading';
import { SignedIn } from '../components/signed-in';
import { ApiError } from '../lib/api';
import {
  AUTHOR_LABEL,
  conversationReport,
  conversationStats,
  PATH_LABEL,
  SIMULATION_STATUS_LABEL,
  usd
} from '../lib/conversation-report';
import { formatPhone, formatWhen, handoffLabel } from '../lib/format';
import { useAdminConversation } from '../lib/queries';

export const Route = createFileRoute('/admin/conversations/$conversationId')({
  component: () => (
    <SignedIn>
      <ConversationPage />
    </SignedIn>
  )
});

const STATUS_CLASS: Record<ConversationSimulation['status'], string> = {
  running: 'bg-neutral-100 text-neutral-700',
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-amber-100 text-amber-800'
};

/**
 * Indented JSON for reading; the raw text when it does not parse.
 */
const prettyJson = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

type TimelineEntry =
  { kind: 'message'; at: string; message: AdminMessage } | { kind: 'call'; at: string; call: AdminAiCall };

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const detail = useAdminConversation(conversationId);
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  const timeline: TimelineEntry[] = detail.data
    ? [
        ...detail.data.messages.map((message) => ({ kind: 'message' as const, at: message.at, message })),
        ...detail.data.ai_calls.map((call) => ({ kind: 'call' as const, at: call.at, call }))
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/conversations" className="text-sm text-neutral-500">
            ← Conversas
          </Link>
          {detail.data && (
            <h1 className="truncate text-xl font-semibold">
              {detail.data.conversation.store_name} · {formatPhone(detail.data.conversation.customer_phone)}
            </h1>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {detail.data && <CopyReport detail={detail.data} />}
          <UserButton />
        </div>
      </header>

      {detail.isPending && <Loading />}
      {notFound && <p className="text-sm text-neutral-600">Conversa não encontrada.</p>}
      {detail.isError && !notFound && <p className="text-sm text-red-700">Não foi possível carregar a conversa.</p>}

      {detail.data && (
        <>
          {detail.data.simulation && <SimulationCard simulation={detail.data.simulation} />}
          <Stats detail={detail.data} />

          <ol className="flex flex-col gap-2">
            {timeline.map((entry) =>
              entry.kind === 'message' ? (
                <MessageEntry key={entry.message.id} message={entry.message} />
              ) : (
                <CallEntry key={entry.call.id} call={entry.call} />
              )
            )}
          </ol>
        </>
      )}
    </div>
  );
}

function CopyReport({ detail }: { detail: AdminConversationDetail }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(conversationReport(detail));
      setState('copied');
    } catch {
      setState('failed');
    }

    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title="Copia título, checks, totais e a conversa inteira em texto"
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
    >
      {state === 'copied' ? 'Copiado ✓' : state === 'failed' ? 'Não copiou' : 'Copiar para depurar'}
    </button>
  );
}

function SimulationCard({ simulation }: { simulation: ConversationSimulation }) {
  const failed = simulation.checks.filter(({ pass }) => !pass);
  const passed = simulation.checks.filter(({ pass }) => pass);

  return (
    <section className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium">{simulation.title}</span>{' '}
          <code className="font-mono text-xs text-neutral-500">
            {simulation.scenario_id}
            {simulation.repeat_index > 0 && ` #${simulation.repeat_index + 1}`}
          </code>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[simulation.status]}`}>
          {SIMULATION_STATUS_LABEL[simulation.status]}
        </span>
      </div>

      <p className="mt-1 text-xs text-neutral-600">
        <Link
          to="/admin/simulations/$runId"
          params={{ runId: simulation.run_id }}
          className="font-medium text-red-700 hover:text-red-800"
        >
          {simulation.run_name}
        </Link>{' '}
        · cliente {simulation.customer_model} · {simulation.turns} falas do cliente · teste{' '}
        {usd.format(simulation.customer_cost_usd + simulation.judge_cost_usd)}
      </p>

      {(simulation.persona || simulation.goal) && (
        <p className="mt-2 text-xs text-neutral-700">
          {simulation.persona && <span className="block">Persona: {simulation.persona}</span>}
          {simulation.goal && <span className="block">Objetivo: {simulation.goal}</span>}
        </p>
      )}
      <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">Fatos: {simulation.facts}</p>

      {simulation.error && <p className="mt-2 text-amber-800">Erro: {simulation.error}</p>}

      {simulation.checks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {[...failed, ...passed].map((check) => (
            <li key={check.name} className="flex gap-2">
              <span className={check.pass ? 'text-green-700' : 'text-red-700'}>{check.pass ? '✓' : '✗'}</span>
              <span className="min-w-0 break-words">
                <span className="font-medium">{check.name}</span>{' '}
                {check.pass ? (
                  <span className="text-neutral-600">{check.actual}</span>
                ) : (
                  <span className="text-neutral-600">
                    esperado {check.expected} → <span className="text-red-700">{check.actual}</span>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stats({ detail }: { detail: AdminConversationDetail }) {
  const { conversation } = detail;
  const stats = conversationStats(detail);

  const items: [string, string][] = [
    [
      'Situação',
      conversation.mode === 'human' ? `Com atendente: ${handoffLabel(conversation.handoff_reason)}` : 'Com o bot'
    ],
    [
      'Mensagens',
      `${stats.customerMessages} cliente · ${stats.botMessages} bot${stats.staffMessages ? ` · ${stats.staffMessages} loja` : ''}`
    ],
    ['Período', stats.firstAt ? `${formatWhen(stats.firstAt)} → ${formatWhen(stats.lastAt)}` : '—'],
    [
      'Custo de IA',
      `${usd.format(stats.totalCostUsd)} (modelo ${usd.format(stats.llmCostUsd)} · Jev ${usd.format(stats.jevCostUsd)})`
    ],
    [
      'Chamadas',
      `${stats.llmCalls} modelo · ${stats.jevCalls} Jev · ${stats.inputTokens}/${stats.outputTokens} tokens`
    ],
    ['Ferramentas', `${stats.toolCalls} chamadas${stats.failedTools ? ` · ${stats.failedTools} com erro` : ''}`],
    ['Modelos', stats.models.join(', ') || '—'],
    ['Prompt', stats.promptVersions.join(', ') || '—']
  ];

  return (
    <dl className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-neutral-500">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MessageEntry({ message }: { message: AdminMessage }) {
  return (
    <li className={`flex ${message.incoming ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          message.incoming ? 'bg-white ring-1 ring-neutral-200' : 'bg-green-50 ring-1 ring-green-200'
        }`}
      >
        <p className="text-xs text-neutral-500">
          {AUTHOR_LABEL[message.author]} · {formatWhen(message.at)}
        </p>
        <MessageBody body={message.body} />
      </div>
    </li>
  );
}

function CallEntry({ call }: { call: AdminAiCall }) {
  return (
    <li className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
      <p>
        <span className="font-medium">{call.provider === 'jev' ? 'Jev' : call.model}</span> ·{' '}
        {PATH_LABEL[call.path] ?? call.path}
        {call.intent && ` · intenção ${call.intent}`}
        {call.confidence !== null && ` (${Math.round(call.confidence * 100)}%)`}
      </p>
      <p className="text-neutral-500">
        {usd.format(call.cost_usd)} · {call.latency_ms} ms · {call.input_tokens}/{call.output_tokens} tokens · prompt{' '}
        {call.prompt_version ?? 'sem versão'} · {formatWhen(call.at)}
      </p>
      {call.tools?.map((tool, index) => (
        <div key={index} className="mt-1">
          <span className={tool.ok ? 'text-green-700' : 'text-red-700'}>
            {tool.ok ? '✓' : '✕'} {tool.name}
            {tool.error && ` (${tool.error})`}
          </span>
          {tool.args && (
            <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-[11px]">
              {prettyJson(tool.args)}
            </pre>
          )}
        </div>
      ))}
    </li>
  );
}
