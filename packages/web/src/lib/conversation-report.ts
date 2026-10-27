import type { AdminConversationDetail, AdminMessage, SimulationStatus } from './queries';

import { formatPhone, formatWhen, handoffLabel } from './format';

export const PATH_LABEL: Record<string, string> = {
  jev_direct: 'Jev decidiu sozinho',
  llm_fallback: 'Modelo completo',
  llm_reply: 'Resposta após ação do Jev',
  transcription: 'Transcrição de áudio'
};

export const AUTHOR_LABEL: Record<AdminMessage['author'], string> = {
  customer: 'Cliente',
  bot: 'Bot',
  staff: 'Loja'
};

export const SIMULATION_STATUS_LABEL: Record<SimulationStatus, string> = {
  running: 'Rodando',
  passed: 'Passou',
  failed: 'Falhou',
  error: 'Erro'
};

export const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Totals shown at the top of the timeline and in the copied report.
 */
export const conversationStats = ({ messages, ai_calls: calls }: AdminConversationDetail) => {
  const llm = calls.filter(({ provider }) => provider !== 'jev');
  const jev = calls.filter(({ provider }) => provider === 'jev');
  const tools = calls.flatMap(({ tools: traces }) => traces ?? []);

  return {
    customerMessages: messages.filter(({ author }) => author === 'customer').length,
    botMessages: messages.filter(({ author }) => author === 'bot').length,
    staffMessages: messages.filter(({ author }) => author === 'staff').length,
    firstAt: messages[0]?.at ?? null,
    lastAt: messages.at(-1)?.at ?? null,
    llmCalls: llm.length,
    jevCalls: jev.length,
    llmCostUsd: sum(llm.map(({ cost_usd }) => cost_usd)),
    jevCostUsd: sum(jev.map(({ cost_usd }) => cost_usd)),
    totalCostUsd: sum(calls.map(({ cost_usd }) => cost_usd)),
    inputTokens: sum(calls.map(({ input_tokens }) => input_tokens)),
    outputTokens: sum(calls.map(({ output_tokens }) => output_tokens)),
    models: [...new Set(llm.map(({ model }) => model))],
    promptVersions: [...new Set(calls.flatMap(({ prompt_version }) => (prompt_version ? [prompt_version] : [])))],
    toolCalls: tools.length,
    failedTools: tools.filter(({ ok }) => !ok).length
  };
};

/**
 * Plain-text report of a conversation to paste when debugging: the simulation (scenario, what passed, what failed),
 * the totals and the whole timeline with AI calls and tool arguments.
 */
export const conversationReport = (detail: AdminConversationDetail) => {
  const { conversation, simulation } = detail;
  const stats = conversationStats(detail);
  const lines: string[] = [];

  if (simulation) {
    const passed = simulation.checks.filter(({ pass }) => pass);
    const failed = simulation.checks.filter(({ pass }) => !pass);

    lines.push(
      `# ${simulation.title} (${simulation.scenario_id}${simulation.repeat_index > 0 ? ` #${simulation.repeat_index + 1}` : ''}) — ${SIMULATION_STATUS_LABEL[simulation.status]}`,
      `Rodada: ${simulation.run_name} · cliente simulado ${simulation.customer_model} · ${simulation.turns} falas do cliente`
    );
    if (simulation.persona) {
      lines.push(`Persona: ${simulation.persona}`);
    }

    if (simulation.goal) {
      lines.push(`Objetivo: ${simulation.goal}`);
    }

    lines.push(`Fatos: ${simulation.facts}`);

    if (simulation.error) {
      lines.push(`Erro: ${simulation.error}`);
    }

    lines.push(
      '',
      `## Deu errado (${failed.length})`,
      ...(failed.length
        ? failed.map(({ name, expected, actual }) => `✗ ${name}: esperado ${expected} → obtido ${actual}`)
        : ['nada']),
      '',
      `## Deu certo (${passed.length})`,
      ...(passed.length ? passed.map(({ name, actual }) => `✓ ${name}: ${actual}`) : ['nada']),
      ''
    );
  }

  lines.push(
    `## Conversa: ${conversation.store_name} · ${formatPhone(conversation.customer_phone)} · ${
      conversation.mode === 'human' ? `com atendente (${handoffLabel(conversation.handoff_reason)})` : 'com o bot'
    }`,
    `Mensagens: ${stats.customerMessages} cliente / ${stats.botMessages} bot / ${stats.staffMessages} loja`,
    `IA: ${stats.llmCalls} modelo (${usd.format(stats.llmCostUsd)}) + ${stats.jevCalls} Jev (${usd.format(stats.jevCostUsd)}) = ${usd.format(stats.totalCostUsd)} · ${stats.inputTokens}/${stats.outputTokens} tokens`,
    `Modelos: ${stats.models.join(', ') || '—'} · prompt ${stats.promptVersions.join(', ') || '—'}`,
    `Ferramentas: ${stats.toolCalls} chamadas, ${stats.failedTools} com erro`,
    ''
  );

  const timeline = [
    ...detail.messages.map((message) => ({
      at: message.at,
      text: `[${formatWhen(message.at)}] ${AUTHOR_LABEL[message.author]}: ${message.body}`
    })),
    ...detail.ai_calls.map((call) => ({
      at: call.at,
      text: [
        `  ↳ ${call.provider === 'jev' ? 'Jev' : call.model} · ${PATH_LABEL[call.path] ?? call.path}${
          call.intent ? ` · intenção ${call.intent}` : ''
        }${call.confidence !== null ? ` (${Math.round(call.confidence * 100)}%)` : ''} · ${usd.format(call.cost_usd)}`,
        ...(call.tools ?? []).map(
          (tool) => `    ${tool.ok ? '✓' : '✗'} ${tool.name} ${tool.args ?? ''}${tool.error ? ` (${tool.error})` : ''}`
        )
      ].join('\n')
    }))
  ].sort((a, b) => a.at.localeCompare(b.at));

  lines.push(...timeline.map(({ text }) => text));

  return lines.join('\n');
};
