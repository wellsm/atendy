import type { ReactNode } from 'react';
import type { ProspectLead, ProspectStatus } from '../lib/queries';

import { SystemChip } from './prospecting-leads-parts';
import { formatPhone, formatWhen } from '../lib/format';
import { useUpdateProspect } from '../lib/queries';

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';

const LINK = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100';

/**
 * Keys of `info` that a structured field already shows, only when that field is filled.
 */
const shownInfoKeys = (lead: ProspectLead) => {
  const keys: [string, unknown][] = [
    ['bairro', lead.neighborhood],
    ['categoria', lead.category],
    ['cidade', lead.city],
    ['zona', lead.zone],
    ['cep', lead.postal_code],
    ['site', lead.site],
    ['nota', lead.rating],
    // Reviews are shown only inside the rating fact.
    ['avaliacoes', lead.rating !== null ? lead.reviews : null]
  ];

  return new Set(keys.filter(([, value]) => value !== null && value !== '').map(([key]) => key));
};

const mapsUrl = (lead: ProspectLead) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [lead.name, lead.neighborhood, lead.city].filter(Boolean).join(' ')
  )}`;

const siteUrl = (site: string) => (/^https?:\/\//i.test(site) ? site : `https://${site}`);

const actionsFor = (lead: ProspectLead): [ProspectStatus, string][] => {
  switch (lead.status) {
    case 'available':
      return [
        ['queued', 'Enviar'],
        ['canceled', 'Não enviar'],
        ['manual', 'Já contatei']
      ];
    case 'queued':
      return [
        ['available', 'Tirar da fila'],
        ['canceled', 'Não enviar'],
        ['manual', 'Já contatei']
      ];
    case 'failed':
    case 'canceled':
      return [
        ['available', 'Voltar a disponível'],
        ['queued', 'Enviar'],
        ['manual', 'Já contatei']
      ];
    case 'sending':
      return lead.stuck
        ? [
            ['sent', 'Marcar como enviada'],
            ['queued', 'Enviar de novo']
          ]
        : [];
    case 'manual':
      return [['replied', 'Respondeu']];
    default:
      return [];
  }
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

export function LeadDetail({ lead }: { lead: ProspectLead }) {
  const update = useUpdateProspect();

  const place = [[lead.neighborhood, lead.postal_code, lead.zone].filter(Boolean).join(' · '), lead.city]
    .filter(Boolean)
    .join(', ');

  const shown = shownInfoKeys(lead);
  const extra = Object.entries(lead.info).filter(([key]) => !shown.has(key.toLowerCase()));
  const actions = actionsFor(lead);

  const sentDates: [string, string | null][] = [
    ['Enviada', lead.sent_at],
    ['Entregue', lead.delivered_at],
    ['Lida', lead.read_at],
    ['Respondeu', lead.replied_at]
  ];

  return (
    <div className="flex flex-col gap-3 rounded-md bg-neutral-50 p-3 text-sm">
      <dl className="flex flex-col gap-1">
        {lead.category && <Fact label="Categoria">{lead.category}</Fact>}
        {place && <Fact label="Local">{place}</Fact>}
        {lead.rating !== null && (
          <Fact label="Avaliação">
            {lead.rating.toFixed(1).replace('.', ',')}
            {lead.reviews !== null && ` (${lead.reviews} avaliações)`}
          </Fact>
        )}
        <Fact label="Telefone">
          {formatPhone(lead.phone)}
          {lead.mobile !== null && ` (${lead.mobile ? 'celular' : 'fixo'})`}
        </Fact>
        {lead.site && (
          <Fact label="Site">
            <a href={siteUrl(lead.site)} target="_blank" rel="noopener noreferrer" className="underline">
              {lead.site}
            </a>
          </Fact>
        )}
        <Fact label="Sistemas">
          {lead.systems && lead.systems.length > 0 ? (
            <div className="flex flex-col gap-1">
              {lead.systems.map((system) => (
                <div key={`${system.kind}-${system.name}`} className="flex flex-wrap items-center gap-2">
                  <SystemChip system={system} />
                  {system.source && <span className="text-xs text-neutral-500">{system.source}</span>}
                </div>
              ))}
            </div>
          ) : lead.situation === 'online_order' ? (
            <span className="text-neutral-600">Pedir on-line (plataforma não identificada)</span>
          ) : (
            <span className="text-neutral-600">Nenhum sistema encontrado</span>
          )}
        </Fact>
      </dl>

      <div className="flex flex-wrap gap-2">
        {lead.mobile && (
          <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener noreferrer" className={LINK}>
            Abrir WhatsApp
          </a>
        )}
        <a href={mapsUrl(lead)} target="_blank" rel="noopener noreferrer" className={LINK}>
          Ver no Maps
        </a>
        {lead.site && (
          <a href={siteUrl(lead.site)} target="_blank" rel="noopener noreferrer" className={LINK}>
            Site
          </a>
        )}
      </div>

      {extra.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
          {extra.map(([key, value]) => (
            <div key={key}>
              <dt className="inline font-medium">{key}: </dt>
              <dd className="inline">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {lead.failure_reason && <p className="text-red-700">Falha: {lead.failure_reason}</p>}

      {lead.sent_message ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Mensagem enviada</p>
          <p className="whitespace-pre-wrap">{lead.sent_message}</p>
          <p className="text-xs text-neutral-500">
            {sentDates
              .filter(([, date]) => date)
              .map(([label, date]) => `${label} ${formatWhen(date)}`)
              .join(' · ')}
          </p>
        </div>
      ) : (
        <div>
          <p className="font-medium">Variações</p>
          <ul className="list-disc pl-5">
            {lead.messages.map((message) => (
              <li key={message} className="whitespace-pre-wrap">
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        // Remounted when the saved note changes, so the field follows the server.
        key={lead.note ?? ''}
        defaultValue={lead.note ?? ''}
        placeholder="Nota"
        aria-label={`Nota de ${lead.name}`}
        onBlur={(event) => {
          const note = event.target.value.trim();

          if (note !== (lead.note ?? '')) {
            update.mutate({ id: lead.id, note: note || null });
          }
        }}
        className={INPUT}
      />
      {update.isError && <p className="text-red-700">Não foi possível salvar.</p>}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map(([next, label]) => (
            <button
              key={`${next}-${label}`}
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: lead.id, status: next })}
              className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
