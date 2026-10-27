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
  bot: 'bg-amber-100 text-amber-800',
  market: 'bg-blue-100 text-blue-800',
  whats: 'bg-green-100 text-green-800',
  other: 'bg-neutral-100 text-neutral-700'
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
    <span className={`${CHIP} border border-neutral-200 text-neutral-500`}>Nada detectado</span>
  );
}

/**
 * Fit score 0-10: filled from 8, soft from 5, outline below.
 */
export function ScoreBadge({ score }: { score: number | null }) {
  const tone =
    score === null || score < 5
      ? 'border border-neutral-300 text-neutral-500'
      : score < 8
        ? 'bg-amber-100 text-amber-800'
        : 'bg-green-600 text-white';

  return (
    <span
      title={score === null ? 'Sem encaixe' : `Encaixe ${score} de 10`}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-medium tabular-nums ${tone}`}
    >
      {score ?? '–'}
    </span>
  );
}
