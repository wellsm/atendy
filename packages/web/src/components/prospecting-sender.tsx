import type { ProspectPauseReason, ProspectStatus } from '../lib/queries';

import { useState } from 'react';

import { Loading } from './loading';
import { formatWhen } from '../lib/format';
import { useProspecting, useUpdateProspecting } from '../lib/queries';

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  available: 'Disponível',
  queued: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  replied: 'Respondeu',
  failed: 'Falhou',
  canceled: 'Não enviar',
  manual: 'Já contatei'
};

const PAUSE_REASON: Record<ProspectPauseReason, string> = {
  manual: 'Pausado por você',
  disconnected: 'Número desconectado',
  failures: '3 envios seguidos falharam',
  low_replies: 'Poucas respostas: menos de 5% em 30 envios'
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const INPUT = 'rounded-md border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none';

export function ProspectingSender() {
  const summary = useProspecting();
  const update = useUpdateProspecting();

  if (!summary.data) {
    return <Loading />;
  }

  const { sender, counts, sent_today, cap_today, reply_rate } = summary.data;

  const idle = counts.queued === 0 && counts.sending === 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${sender.paused || !sender.connected ? 'bg-accepted-bg text-warn-fg' : 'bg-ok-bg text-ok-fg'}`}
        >
          {sender.paused ? 'Pausado' : !sender.connected ? 'Número desconectado' : idle ? 'Fila vazia' : 'Enviando'}
        </span>
        {sender.paused && sender.pause_reason && (
          <span className="text-sm text-fg-2">{PAUSE_REASON[sender.pause_reason]}</span>
        )}
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate({ paused: !sender.paused })}
          className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sender.paused ? 'Retomar envios' : 'Pausar'}
        </button>
      </div>
      {update.isError && <p className="text-sm text-danger-fg">Não foi possível salvar.</p>}

      <p className="text-sm text-fg-2">
        Hoje: {sent_today} de {cap_today} enviadas.{' '}
        {!sender.connected
          ? 'Número desconectado: nenhum envio até conectar de novo.'
          : sender.next_send_at && !sender.paused && !idle
            ? `Próximo envio: ${formatWhen(sender.next_send_at)}.`
            : 'Sem próximo envio agendado.'}{' '}
        {reply_rate !== null && `Taxa de resposta: ${(reply_rate * 100).toFixed(1).replace('.', ',')}%.`}
      </p>

      <SendLimits
        key={`${sender.max_daily}-${sender.window.start_hour}-${sender.window.end_hour}-${sender.window.weekdays.join()}`}
        sender={sender}
      />

      <ul className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_LABEL) as ProspectStatus[]).map((status) => (
          <li key={status} className="rounded-full bg-surface-2 px-3 py-1 text-fg-2">
            {STATUS_LABEL[status]} · {counts[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SendLimits({ sender }: { sender: NonNullable<ReturnType<typeof useProspecting>['data']>['sender'] }) {
  const update = useUpdateProspecting();

  const [maxDaily, setMaxDaily] = useState(String(sender.max_daily));
  const [startHour, setStartHour] = useState(String(sender.window.start_hour));
  const [endHour, setEndHour] = useState(String(sender.window.end_hour));
  const [weekdays, setWeekdays] = useState(sender.window.weekdays);

  const valid =
    Number(maxDaily) >= 1 &&
    Number(maxDaily) <= 200 &&
    Number(startHour) >= 0 &&
    Number(endHour) <= 24 &&
    Number(startHour) < Number(endHour) &&
    weekdays.length > 0;

  const toggleDay = (day: number) =>
    setWeekdays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort()
    );

  const onSave = () =>
    update.mutate({
      max_daily: Number(maxDaily),
      window: { start_hour: Number(startHour), end_hour: Number(endHour), weekdays }
    });

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Máximo por dia
          <input
            type="number"
            min={1}
            max={200}
            value={maxDaily}
            onChange={(event) => setMaxDaily(event.target.value)}
            className={`${INPUT} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1">
          Janela: das (h)
          <input
            type="number"
            min={0}
            max={23}
            value={startHour}
            onChange={(event) => setStartHour(event.target.value)}
            className={`${INPUT} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1">
          até (h)
          <input
            type="number"
            min={1}
            max={24}
            value={endHour}
            onChange={(event) => setEndHour(event.target.value)}
            className={`${INPUT} w-24`}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {WEEKDAYS.map((label, day) => (
          <label key={label} className="flex items-center gap-1">
            <input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggleDay(day)} />
            {label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">
        Horário de Brasília; o fim da janela não inclui a hora (18 = último envio antes das 18h). O limite diário começa
        em 20 e sobe 10 por semana até o máximo.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!valid || update.isPending}
          onClick={onSave}
          className="rounded-md border border-line-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          {update.isPending ? 'Salvando…' : 'Salvar limites'}
        </button>
        {update.isSuccess && <span className="text-sm text-ok-fg">Salvo.</span>}
        {update.isError && <span className="text-sm text-danger-fg">Não foi possível salvar.</span>}
      </div>
    </div>
  );
}
