import type { ProspectFilters, ProspectLead, ProspectSituation, ProspectStatus } from '../lib/queries';

import { useEffect, useState } from 'react';

import { Loading } from './loading';
import { LeadDetail } from './prospecting-lead-detail';
import { ScoreBadge, SITUATION_LABEL, SystemChips } from './prospecting-leads-parts';
import { STATUS_LABEL } from './prospecting-sender';
import { formatPhone, formatWhen } from '../lib/format';
import {
  useBulkUpdateProspects,
  useFetchProspectIds,
  useProspects,
  useProspectsOverview,
  useQueueBestProspects
} from '../lib/queries';

type BulkStatus = 'available' | 'queued' | 'canceled' | 'manual';

type Place = { city: string; zone: string; neighborhood: string };

type Places = NonNullable<ReturnType<typeof useProspectsOverview>['data']>['places'];

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';

const HOME_CITY = 'São Paulo';

const SITUATIONS = Object.keys(SITUATION_LABEL) as ProspectSituation[];

const FUNNEL: ProspectStatus[] = [
  'available',
  'queued',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
  'canceled',
  'manual'
];

const BULK_ACTIONS: [BulkStatus, string][] = [
  ['queued', 'Enviar'],
  ['available', 'Tirar da fila'],
  ['canceled', 'Não enviar'],
  ['manual', 'Já contatei'],
  ['available', 'Voltar a disponível']
];

const SORTS: [NonNullable<ProspectFilters['sort']>, string][] = [
  ['score', 'Encaixe'],
  ['reviews', 'Mais avaliações'],
  ['name', 'Nome']
];

/**
 * São Paulo / Zona Leste / Penha, each level only when the base has it.
 */
const defaultPlace = (places: Places): Place => {
  const place: Place = { city: '', zone: '', neighborhood: '' };

  if (!places.some((item) => item.city === HOME_CITY)) {
    return place;
  }

  place.city = HOME_CITY;

  if (places.some((item) => item.city === HOME_CITY && item.zone === 'Zona Leste')) {
    place.zone = 'Zona Leste';

    if (places.some((item) => item.city === HOME_CITY && item.zone === 'Zona Leste' && item.neighborhood === 'Penha')) {
      place.neighborhood = 'Penha';
    }
  }

  return place;
};

const distinct = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => !!value))];

const statusLabel = (lead: ProspectLead) => (lead.stuck ? 'Envio incerto' : STATUS_LABEL[lead.status]);

/**
 * The date that belongs to the lead's current status.
 */
const statusDate = (lead: ProspectLead) => {
  switch (lead.status) {
    case 'replied':
      return lead.replied_at;
    case 'read':
      return lead.read_at;
    case 'delivered':
      return lead.delivered_at;
    case 'sent':
    case 'failed':
      return lead.sent_at;
    default:
      return null;
  }
};

const subtitle = (lead: ProspectLead) =>
  [
    lead.category,
    lead.neighborhood,
    lead.city && lead.city !== HOME_CITY ? lead.city : null,
    lead.rating !== null
      ? `${lead.rating.toFixed(1).replace('.', ',')}${lead.reviews !== null ? ` (${lead.reviews})` : ''}`
      : null
  ]
    .filter(Boolean)
    .join(' · ');

export function ProspectingLeads() {
  // The places come from the whole base, so the default place is known before the first list request.
  const base = useProspectsOverview({});

  if (base.isError) {
    return <p className="text-sm text-red-700">Não foi possível carregar os leads.</p>;
  }

  if (!base.data) {
    return <Loading />;
  }

  return <LeadsPanel places={base.data.places} categories={base.data.categories} />;
}

function LeadsPanel({ places, categories }: { places: Places; categories: string[] }) {
  const [place, setPlace] = useState(() => defaultPlace(places));
  const [placeDefaulted, setPlaceDefaulted] = useState(places.length > 0);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<ProspectStatus | ''>('');
  const [situation, setSituation] = useState<ProspectSituation | ''>('');
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<NonNullable<ProspectFilters['sort']>>('score');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  // The base may still be empty at mount (import comes later): apply the default the first time it has places.
  useEffect(() => {
    if (placeDefaulted || !places.length) {
      return;
    }

    setPlaceDefaulted(true);
    setPlace(defaultPlace(places));
  }, [placeDefaulted, places]);

  const filters: ProspectFilters = {
    city: place.city || undefined,
    zone: place.zone || undefined,
    neighborhood: place.neighborhood || undefined,
    category: category || undefined,
    status: status || undefined,
    situation: situation || undefined,
    mobile: mobile || undefined,
    q: search.trim() || undefined,
    sort
  };

  const overview = useProspectsOverview({ city: filters.city, zone: filters.zone, neighborhood: filters.neighborhood });
  const leads = useProspects(filters);
  const fetchIds = useFetchProspectIds();
  const bulk = useBulkUpdateProspects();
  const queueBest = useQueueBestProspects();

  const rows = leads.data?.pages.flatMap((page) => page.leads) ?? [];
  const total = overview.data ? Object.values(overview.data.statuses).reduce((sum, count) => sum + count, 0) : 0;

  const cities = distinct(places.map((item) => item.city));
  const zones = distinct(places.filter((item) => !place.city || item.city === place.city).map((item) => item.zone));
  const neighborhoods = distinct(
    places
      .filter((item) => (!place.city || item.city === place.city) && (!place.zone || item.zone === place.zone))
      .map((item) => item.neighborhood)
  );

  // A new filter or selection makes the last result stale.
  const select = (next: Set<string> | ((current: Set<string>) => Set<string>)) => {
    setSelected(next);
    setResult(null);
  };

  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      select(new Set());
    };

  const toggle = (id: string) =>
    select((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });

  const onSelectAll = async () => {
    setSelecting(true);

    try {
      select(new Set(await fetchIds(filters)));
    } finally {
      setSelecting(false);
    }
  };

  const onBulk = (target: BulkStatus) => {
    bulk.mutate(
      { ids: [...selected], status: target },
      {
        onSuccess: ({ updated, skipped }) => {
          setResult(`${updated} atualizados, ${skipped} ignorados.`);
          setSelected(new Set());
        }
      }
    );
  };

  const onQueueBest = () => {
    queueBest.mutate(filters, {
      onSuccess: ({ queued }) => {
        setSelected(new Set());
        setResult(
          queued === 0
            ? 'Nenhum lead disponível com esses filtros.'
            : `${queued} ${queued === 1 ? 'lead' : 'leads'} na fila.`
        );
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SITUATIONS.map((key) => (
          <li key={key}>
            <button
              type="button"
              aria-pressed={situation === key}
              onClick={() => filter(setSituation)(situation === key ? '' : key)}
              className={`flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left ${
                situation === key ? 'border-red-500 bg-red-50' : 'border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              <span className="text-2xl font-semibold tabular-nums">{overview.data?.situations[key] ?? 0}</span>
              <span className="text-xs text-neutral-600">{SITUATION_LABEL[key]}</span>
            </button>
          </li>
        ))}
      </ul>

      <ul className="flex flex-wrap gap-2 text-xs">
        {FUNNEL.map((key) => (
          <li key={key} className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
            {STATUS_LABEL[key]} · {overview.data?.statuses[key] ?? 0}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <select
          value={place.city}
          onChange={(event) => filter(setPlace)({ city: event.target.value, zone: '', neighborhood: '' })}
          aria-label="Cidade"
          className={INPUT}
        >
          <option value="">Todas as cidades</option>
          {cities.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={place.zone}
          onChange={(event) => filter(setPlace)({ ...place, zone: event.target.value, neighborhood: '' })}
          aria-label="Zona"
          className={INPUT}
        >
          <option value="">Todas as zonas</option>
          {zones.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={place.neighborhood}
          onChange={(event) => filter(setPlace)({ ...place, neighborhood: event.target.value })}
          aria-label="Bairro"
          className={INPUT}
        >
          <option value="">Todos os bairros</option>
          {neighborhoods.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(event) => filter(setCategory)(event.target.value)}
          aria-label="Categoria"
          className={INPUT}
        >
          <option value="">Todas as categorias</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => filter(setStatus)(event.target.value as ProspectStatus | '')}
          aria-label="Filtrar por status"
          className={INPUT}
        >
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as ProspectStatus[]).map((item) => (
            <option key={item} value={item}>
              {STATUS_LABEL[item]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => filter(setSort)(event.target.value as typeof sort)}
          aria-label="Ordenar por"
          className={INPUT}
        >
          {SORTS.map(([key, label]) => (
            <option key={key} value={key}>
              Ordenar: {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => filter(setSearch)(event.target.value)}
          placeholder="Buscar por nome, telefone, categoria ou sistema"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mobile} onChange={(event) => filter(setMobile)(event.target.checked)} />
          Só com WhatsApp provável
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-600">
          {leads.data?.pages[0]?.total ?? 0} de {total}
        </span>
        <button
          type="button"
          disabled={selecting}
          onClick={() => void onSelectAll()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50"
        >
          {selecting ? 'Selecionando…' : 'Selecionar todos do filtro'}
        </button>
        <button
          type="button"
          disabled={queueBest.isPending}
          onClick={onQueueBest}
          className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
        >
          Enviar para os 20 melhores
        </button>
        {result && <span className="text-neutral-700">{result}</span>}
        {(bulk.isError || queueBest.isError) && <span className="text-red-700">Não foi possível atualizar.</span>}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-600">{selected.size} selecionados</span>
          <button type="button" onClick={() => select(new Set())} className="text-neutral-500 underline">
            Limpar
          </button>
          {BULK_ACTIONS.map(([target, label]) => (
            <button
              key={label}
              type="button"
              disabled={bulk.isPending}
              onClick={() => onBulk(target)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {leads.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum lead.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100">
          {rows.map((lead) => (
            <LeadRow key={lead.id} lead={lead} checked={selected.has(lead.id)} onToggle={() => toggle(lead.id)} />
          ))}
        </ul>
      )}

      {leads.hasNextPage && (
        <button
          type="button"
          disabled={leads.isFetchingNextPage}
          onClick={() => void leads.fetchNextPage()}
          className="self-start rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          {leads.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
}

function LeadRow({ lead, checked, onToggle }: { lead: ProspectLead; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);

  const date = statusDate(lead);
  const line = subtitle(lead);

  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Selecionar ${lead.name}`} />
        <ScoreBadge score={lead.score} />
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 flex-col text-left">
          <span className="font-medium">{lead.name}</span>
          {line && <span className="text-xs text-neutral-500">{line}</span>}
        </button>
        <span className="hidden text-neutral-500 sm:inline">{formatPhone(lead.phone)}</span>
        <span className="hidden flex-wrap gap-1 md:flex">
          <SystemChips lead={lead} />
        </span>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700">
          {statusLabel(lead)}
          {date && ` · ${formatWhen(date)}`}
        </span>
      </div>

      {open && (
        <div className="ml-7">
          <LeadDetail lead={lead} />
        </div>
      )}
    </li>
  );
}
