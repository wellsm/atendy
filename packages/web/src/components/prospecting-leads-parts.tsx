import type { ProspectLead, ProspectSituation, ProspectSystem } from '../lib/queries';

export const SITUATION_LABEL: Record<ProspectSituation, string> = {
  whatsapp: 'Pede no WhatsApp',
  online_order: 'Pedir on-line sem plataforma',
  marketplace: 'Só marketplace',
  competitor: 'Usa concorrente',
  none: 'Nada detectado'
};

const CHIP = 'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

const SYSTEM_TONE: Record<ProspectSystem['kind'], string> = {
  bot: 'bg-accepted-bg text-warn-fg',
  market: 'bg-out-bg text-out-fg',
  whats: 'bg-ok-bg text-ok-fg',
  other: 'bg-surface-2 text-fg-2'
};

export function SystemChip({ system }: { system: ProspectSystem }) {
  return <span className={`${CHIP} ${SYSTEM_TONE[system.kind]}`}>{system.name}</span>;
}

export function SystemChips({ lead }: { lead: ProspectLead }) {
  if (lead.systems && lead.systems.length > 0) {
    return lead.systems.map((system) => <SystemChip key={`${system.kind}-${system.name}`} system={system} />);
  }

  return lead.situation === 'online_order' ? (
    <span className={`${CHIP} bg-violet-100 text-violet-800`}>Pedir on-line</span>
  ) : (
    <span className={`${CHIP} border border-line text-muted`}>Nada detectado</span>
  );
}

/**
 * Fit score 0-10: filled from 8, soft from 5, outline below.
 */
export function ScoreBadge({ score }: { score: number | null }) {
  const tone =
    score === null || score < 5
      ? 'border border-line-2 text-muted'
      : score < 8
        ? 'bg-accepted-bg text-warn-fg'
        : 'bg-on text-white';

  return (
    <span
      title={score === null ? 'Sem encaixe' : `Encaixe ${score} de 10`}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-medium tabular-nums ${tone}`}
    >
      {score ?? '–'}
    </span>
  );
}
