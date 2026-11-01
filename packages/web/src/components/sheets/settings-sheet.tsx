import type { ComponentProps, FormEvent, ReactNode } from 'react';
import type { SettingsTab } from '../../lib/panel-search';
import type {
  DeliveryMode,
  DeliverySettings,
  HourRange,
  MenuCategory,
  NewOrderAfterStatus,
  OrderStatus,
  PaymentMethod,
  PolicySettings,
  PosSettings,
  PreviousAddress,
  Settings,
  StoreLocation
} from '../../lib/queries';

import { useOrganization } from '@clerk/react';
import { useState } from 'react';

import { Sheet } from './sheet';
import { ApiError } from '../../lib/api';
import { centsToInput, parseMoney, PAYMENT_LABEL, STATUS_LABEL } from '../../lib/format';
import { usePanelNavigate, usePanelSearch } from '../../lib/panel-search';
import {
  useLocateStore,
  useMe,
  useMenu,
  useSettings,
  useUpdateDelivery,
  useUpdateHours,
  useUpdatePayment,
  useUpdatePolicy,
  useUpdatePosSettings,
  useUpdateStockAlert,
  useUpdateStore
} from '../../lib/queries';
import { Loading } from '../loading';
import { StaffTab } from '../staff/staff-settings';
import { Toggle } from '../toggle';

const INPUT =
  'rounded-lg border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:bg-hover';

/**
 * Portuguese text per API error field; the API messages are for developers.
 */
const FIELD_ERROR: Record<string, string> = {
  name: 'O nome precisa ter de 1 a 80 caracteres.',
  hours: 'Confira os horários: há intervalos sobrepostos ou inválidos.',
  flat_fee_cents: 'A taxa de entrega precisa ser zero ou mais.',
  zones: 'Confira os bairros: nomes repetidos, vazios ou taxa inválida.',
  bands: 'Confira as faixas: de 1 a 10, distâncias crescentes entre 0,1 e 100 km.',
  store_location: 'Localize o endereço da loja antes de entregar por distância.',
  payment_methods: 'Escolha pelo menos uma forma de pagamento.',
  sop: 'As instruções podem ter no máximo 2000 caracteres.',
  stock_alert_phone: 'Confira o WhatsApp: DDD e número.',
  stock_alert_hour: 'O horário precisa ser uma hora de 0 a 23.',
  pos_layout: 'Escolha o layout padrão: grade ou busca.',
  pos_receipt_width: 'A largura do comprovante precisa ser 58 mm ou 80 mm.'
};

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.status === 409 && error.field === 'pos_cash_control') {
    return 'Feche o caixa antes de desligar o controle.';
  }

  if (error instanceof ApiError && error.status === 400) {
    return (error.field && FIELD_ERROR[error.field]) || 'Algum valor não é válido. Confira e tente de novo.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

const SECTIONS: [SettingsTab, string][] = [
  ['store', 'Loja'],
  ['hours', 'Horários'],
  ['delivery', 'Entrega'],
  ['payment', 'Pagamento'],
  ['policy', 'Regras'],
  ['stock', 'Estoque'],
  ['pos', 'PDV'],
  ['staff', 'Funcionários']
];

/**
 * One tab per section (`?tab=`); each saves on its own.
 */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { tab = 'store' } = usePanelSearch();
  const navigate = usePanelNavigate();

  return (
    <Sheet width="md" label="Configurações" onClose={onClose}>
      <div className="flex shrink-0 flex-col gap-3.5 border-b border-line px-4 pt-4 md:px-6">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-bold">Configurações</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="size-9 shrink-0 rounded-full bg-surface-2 text-fg-2 hover:bg-line"
          >
            ✕
          </button>
        </div>
        <nav className="-mx-4 flex gap-5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => void navigate({ sheet: 'settings', tab: id }, { replace: true })}
              aria-current={tab === id ? 'page' : undefined}
              className={`-mb-px shrink-0 border-b-2 pb-3 text-sm ${tab === id ? 'border-accent font-semibold text-fg' : 'border-transparent text-muted'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {settings.isPending && <Loading />}
      {settings.isError && <p className="p-6 text-sm text-danger-fg">Não foi possível carregar as configurações.</p>}
      {settings.data && <ActiveSection tab={tab} settings={settings.data} />}
    </Sheet>
  );
}

function ActiveSection({ tab, settings }: { tab: SettingsTab; settings: Settings }) {
  switch (tab) {
    case 'store':
      return <StoreSection />;
    case 'hours':
      return <HoursSection hours={settings.hours} />;
    case 'delivery':
      return <DeliverySection delivery={settings.delivery} location={settings.store_location} />;
    case 'payment':
      return <PaymentSection methods={settings.payment_methods} />;
    case 'policy':
      return <PolicySection policy={settings.policy} />;
    case 'stock':
      return <StockAlertSection phone={settings.stock_alert_phone} hour={settings.stock_alert_hour} />;
    case 'pos':
      return <PosSection pos={settings.pos} />;
    case 'staff':
      return <StaffTab settings={settings.staff} />;
  }
}

function Section(props: {
  title: string;
  description?: string;
  onSubmit: () => void;
  saving: boolean;
  saved: boolean;
  error: unknown;
  invalid?: string;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!props.saving && !props.invalid) {
      props.onSubmit();
    }
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <h3 className="sr-only">{props.title}</h3>
        {props.description && <p className="text-[13px] text-muted">{props.description}</p>}

        <div className={props.description ? 'mt-4' : undefined}>{props.children}</div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-4 py-3.5 md:px-6">
        <button
          type="submit"
          disabled={props.saving || !!props.invalid}
          className="h-[38px] rounded-lg bg-accent px-[18px] text-sm font-medium text-white disabled:opacity-50"
        >
          {props.saving ? 'Salvando…' : 'Salvar'}
        </button>
        {props.invalid && <span className="text-sm text-warn-fg">{props.invalid}</span>}
        {!props.invalid && props.error != null && (
          <span className="text-sm text-danger-fg">{errorText(props.error)}</span>
        )}
        {!props.invalid && props.error == null && props.saved && <span className="text-sm text-ok-fg">✓ Salvo</span>}
      </div>
    </form>
  );
}

/**
 * Text input with a fixed prefix/suffix (`R$`, `km`, `min`) inside the same border.
 */
function AffixInput({
  prefix,
  suffix,
  className = '',
  ...props
}: ComponentProps<'input'> & { prefix?: string; suffix?: string }) {
  const affix = 'flex items-center bg-hover px-2.5 text-sm text-muted';

  return (
    <span className={`flex overflow-hidden rounded-lg border border-line-2 focus-within:border-accent ${className}`}>
      {prefix && <span className={`${affix} border-r border-line`}>{prefix}</span>}
      <input {...props} className="min-w-0 flex-1 px-3 py-2 text-sm font-normal focus:outline-none" />
      {suffix && <span className={`${affix} border-l border-line`}>{suffix}</span>}
    </span>
  );
}

/**
 * Small "✕" button that removes a row.
 */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md px-2 py-1 text-sm text-faint hover:text-danger-fg"
    >
      ✕
    </button>
  );
}

function StoreSection() {
  const me = useMe();
  const update = useUpdateStore();
  const { organization } = useOrganization();
  const [name, setName] = useState(me.data?.store?.name ?? '');

  return (
    <Section
      title="Loja"
      onSubmit={() =>
        update.mutate(
          { name: name.trim() },
          {
            // The store menu lists Clerk org names; best effort, the store keeps its name if Clerk fails.
            onSuccess: async ({ store }) => {
              try {
                await organization?.update({ name: store.name });
              } catch {
                // Clerk failed: the menu shows the old name until the next rename.
              }
            }
          }
        )
      }
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
      invalid={name.trim() ? undefined : 'Informe o nome da loja.'}
    >
      <label className="block text-sm font-medium" htmlFor="store-name">
        Nome
      </label>
      <input
        id="store-name"
        value={name}
        maxLength={80}
        onChange={(event) => {
          setName(event.target.value);
          update.reset();
        }}
        className={`mt-1.5 w-full ${INPUT}`}
      />
    </Section>
  );
}

const DEFAULT_ALERT_HOUR = 9;

function StockAlertSection({ phone, hour }: { phone: string | null; hour: number | null }) {
  const update = useUpdateStockAlert();
  const [phoneText, setPhoneText] = useState(phone ?? '');
  const [hourText, setHourText] = useState(String(hour ?? DEFAULT_ALERT_HOUR));
  const parsedHour = /^\d{1,2}$/.test(hourText.trim()) ? Number(hourText) : undefined;
  const invalid = parsedHour === undefined || parsedHour > 23 ? 'O horário precisa ser de 0 a 23.' : undefined;

  return (
    <Section
      title="Estoque"
      description="Todo dia, no horário escolhido, o Atendy manda no WhatsApp o resumo dos itens com estoque baixo ou esgotados. Deixe o número vazio para não receber."
      onSubmit={() =>
        update.mutate({ stock_alert_phone: phoneText.trim() || null, stock_alert_hour: parsedHour ?? null })
      }
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
      invalid={invalid}
    >
      <label className="block text-sm font-medium" htmlFor="stock-alert-phone">
        WhatsApp para alertas
      </label>
      <input
        id="stock-alert-phone"
        value={phoneText}
        inputMode="tel"
        placeholder="(11) 91234-5678"
        onChange={(event) => {
          setPhoneText(event.target.value);
          update.reset();
        }}
        className={`mt-1.5 w-full ${INPUT}`}
      />

      <label className="mt-4 block text-sm font-medium" htmlFor="stock-alert-hour">
        Horário do resumo
      </label>
      <AffixInput
        id="stock-alert-hour"
        value={hourText}
        inputMode="numeric"
        maxLength={2}
        suffix="h"
        className="mt-1.5 w-28"
        onChange={(event) => {
          setHourText(event.target.value);
          update.reset();
        }}
      />
    </Section>
  );
}

function PosSection({ pos }: { pos: PosSettings }) {
  const update = useUpdatePosSettings();
  const [value, setValue] = useState(pos);
  const change = (patch: Partial<PosSettings>) => {
    setValue({ ...value, ...patch });
    update.reset();
  };

  return (
    <Section
      title="PDV"
      description="Padrões do ponto de venda no balcão."
      onSubmit={() => update.mutate(value)}
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
    >
      <label className="block text-sm font-medium" htmlFor="pos-layout">
        Layout padrão
      </label>
      <select
        id="pos-layout"
        value={value.layout}
        onChange={(event) => change({ layout: event.target.value as PosSettings['layout'] })}
        className={`mt-1.5 w-full ${INPUT}`}
      >
        <option value="grid">Grade (comida)</option>
        <option value="search">Busca (produtos)</option>
      </select>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={value.cash_control}
          onChange={(event) => change({ cash_control: event.target.checked })}
        />
        Controlar caixa
      </label>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={value.blind_close}
          onChange={(event) => change({ blind_close: event.target.checked })}
        />
        Fechamento cego
      </label>
      <p className="mt-1 text-xs text-muted">O operador não vê o valor esperado antes de contar</p>

      <label className="mt-4 block text-sm font-medium" htmlFor="pos-receipt-width">
        Largura do comprovante
      </label>
      <select
        id="pos-receipt-width"
        value={value.receipt_width}
        onChange={(event) => change({ receipt_width: Number(event.target.value) as PosSettings['receipt_width'] })}
        className={`mt-1.5 w-full ${INPUT}`}
      >
        <option value={58}>58 mm</option>
        <option value={80}>80 mm</option>
      </select>
    </Section>
  );
}

/**
 * Monday first on screen; data keeps 0 = Sunday.
 */
const WEEK = [
  { weekday: 1, label: 'Segunda' },
  { weekday: 2, label: 'Terça' },
  { weekday: 3, label: 'Quarta' },
  { weekday: 4, label: 'Quinta' },
  { weekday: 5, label: 'Sexta' },
  { weekday: 6, label: 'Sábado' },
  { weekday: 0, label: 'Domingo' }
];

type DayRange = { opens: string; closes: string };

const DEFAULT_RANGE: DayRange = { opens: '18:00', closes: '23:00' };

const toDays = (hours: HourRange[]) => {
  const days: Record<number, DayRange[]> = {};

  for (const { weekday } of WEEK) {
    days[weekday] = hours
      .filter((range) => range.weekday === weekday)
      .map(({ opens_at, closes_at }) => ({ opens: opens_at, closes: closes_at }));
  }

  return days;
};

const rangeHint = ({ opens, closes }: DayRange) => {
  if (opens === closes) {
    return '24h';
  }

  return closes < opens ? 'termina no dia seguinte' : undefined;
};

function HoursSection({ hours }: { hours: HourRange[] }) {
  const update = useUpdateHours();
  const [days, setDays] = useState(() => toDays(hours));

  const change = (next: Record<number, DayRange[]>) => {
    setDays(next);
    update.reset();
  };

  const setRange = (weekday: number, index: number, patch: Partial<DayRange>) =>
    change({
      ...days,
      [weekday]: days[weekday]!.map((range, position) => (position === index ? { ...range, ...patch } : range))
    });

  const copyToAll = (weekday: number) =>
    change(Object.fromEntries(WEEK.map((day) => [day.weekday, days[weekday]!.map((range) => ({ ...range }))])));

  const save = () =>
    update.mutate({
      hours: WEEK.flatMap(({ weekday }) =>
        days[weekday]!.map(({ opens, closes }) => ({ weekday, opens_at: opens, closes_at: closes }))
      )
    });

  return (
    <Section
      title="Horários"
      description="Fora destes horários o bot avisa que a loja está fechada. Abrir e fechar no mesmo horário = 24h."
      onSubmit={save}
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
    >
      <ul className="-mt-2 divide-y divide-line">
        {WEEK.map(({ weekday, label }) => {
          const ranges = days[weekday]!;
          const open = ranges.length > 0;

          return (
            <li key={weekday} className="grid gap-2 py-3.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start sm:gap-4">
              <label className="flex w-fit items-center gap-2.5 py-1.5 text-sm font-medium">
                <Toggle
                  checked={open}
                  label={`${label}: aberto`}
                  onChange={(checked) => change({ ...days, [weekday]: checked ? [{ ...DEFAULT_RANGE }] : [] })}
                />
                {label}
              </label>

              <div className="flex flex-col gap-2">
                {!open && <span className="text-sm text-faint sm:pt-1.5">Fechado</span>}

                {ranges.map((range, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      required
                      aria-label={`${label}: abre`}
                      value={range.opens}
                      onChange={(event) => setRange(weekday, index, { opens: event.target.value })}
                      className={`${INPUT} py-1.5`}
                    />
                    <span className="text-sm text-muted">até</span>
                    <input
                      type="time"
                      required
                      aria-label={`${label}: fecha`}
                      value={range.closes}
                      onChange={(event) => setRange(weekday, index, { closes: event.target.value })}
                      className={`${INPUT} py-1.5`}
                    />
                    {rangeHint(range) && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                        {rangeHint(range)}
                      </span>
                    )}
                    <RemoveButton
                      label="Remover horário"
                      onClick={() => change({ ...days, [weekday]: ranges.filter((_, i) => i !== index) })}
                    />
                  </div>
                ))}

                {open && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <button
                      type="button"
                      onClick={() => change({ ...days, [weekday]: [...ranges, { ...DEFAULT_RANGE }] })}
                      className="font-medium text-accent-fg hover:underline"
                    >
                      + Horário
                    </button>
                    <button type="button" onClick={() => copyToAll(weekday)} className="text-muted hover:underline">
                      Copiar para todos os dias
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

type ZoneRow = { neighborhood: string; fee: string };

type BandRow = { km: string; fee: string };

/**
 * `2,5` / `2.5` km → meters; undefined when not a positive number.
 */
const parseKm = (text: string) => {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());

  return match ? Math.round(Number(`${match[1]}.${match[2] ?? '0'}`) * 1000) : undefined;
};

const metersToKm = (meters: number) => String(meters / 1000).replace('.', ',');

const DELIVERY_MODES = [
  ['flat', 'Taxa fixa', 'Mesmo valor para qualquer endereço'],
  ['by_zone', 'Por bairro', 'Só entrega nos bairros da lista'],
  ['by_distance', 'Por distância', 'Taxa por faixa de km até o cliente']
] as const;

const ROW_HEADER = 'text-xs font-medium uppercase tracking-wide text-muted';

function DeliverySection({ delivery, location }: { delivery: DeliverySettings; location: StoreLocation | null }) {
  const update = useUpdateDelivery();
  const [mode, setMode] = useState<DeliveryMode>(delivery.mode);
  const [flatFee, setFlatFee] = useState(centsToInput(delivery.flat_fee_cents));
  const [zones, setZones] = useState<ZoneRow[]>(() =>
    delivery.zones.map(({ neighborhood, fee_cents }) => ({ neighborhood, fee: centsToInput(fee_cents) }))
  );
  const [bands, setBands] = useState<BandRow[]>(() =>
    (delivery.bands ?? []).map(({ max_meters, fee_cents }) => ({
      km: metersToKm(max_meters),
      fee: centsToInput(fee_cents)
    }))
  );

  const touch = () => update.reset();

  const flatFeeCents = parseMoney(flatFee);
  const zoneFees = zones.map(({ fee }) => parseMoney(fee));
  const bandMeters = bands.map(({ km }) => parseKm(km));
  const bandFees = bands.map(({ fee }) => parseMoney(fee));

  const bandsInvalid = !location
    ? 'Localize o endereço da loja antes de salvar.'
    : !bands.length
      ? 'Adicione pelo menos uma faixa.'
      : bandMeters.some((meters) => meters === undefined || meters < 100 || meters > 100_000)
        ? 'Distâncias entre 0,1 e 100 km.'
        : bandMeters.some((meters, index) => index > 0 && meters! <= bandMeters[index - 1]!)
          ? 'As distâncias precisam crescer de uma faixa para a outra.'
          : bandFees.some((fee) => fee === undefined)
            ? 'Taxa de faixa inválida. Use por exemplo 5,00.'
            : undefined;

  const invalid =
    mode === 'flat'
      ? flatFeeCents === undefined
        ? 'Taxa inválida. Use por exemplo 5,00.'
        : undefined
      : mode === 'by_distance'
        ? bandsInvalid
        : !zones.length
          ? 'Adicione pelo menos um bairro.'
          : zones.some(({ neighborhood }) => !neighborhood.trim())
            ? 'Preencha o nome de todos os bairros.'
            : zoneFees.some((fee) => fee === undefined)
              ? 'Taxa de bairro inválida. Use por exemplo 5,00.'
              : undefined;

  const save = () =>
    update.mutate({
      mode,
      flat_fee_cents: mode === 'flat' ? (flatFeeCents ?? 0) : delivery.flat_fee_cents,
      zones:
        mode === 'by_zone'
          ? zones.map(({ neighborhood }, index) => ({ neighborhood: neighborhood.trim(), fee_cents: zoneFees[index]! }))
          : [],
      bands:
        mode === 'by_distance'
          ? bands.map((_, index) => ({ max_meters: bandMeters[index]!, fee_cents: bandFees[index]! }))
          : []
    });

  return (
    <Section
      title="Entrega"
      description="Retirada na loja está sempre disponível."
      onSubmit={save}
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
      invalid={invalid}
    >
      <div role="radiogroup" aria-label="Forma de cobrar a entrega" className="grid gap-2 sm:grid-cols-3">
        {DELIVERY_MODES.map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => {
              setMode(value);
              touch();
            }}
            className={`flex flex-col gap-0.5 rounded-xl border-[1.5px] px-3.5 py-3 text-left ${
              mode === value ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-2'
            }`}
          >
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>

      {mode === 'flat' && (
        <label className="mt-5 block max-w-52 text-sm font-medium">
          Taxa de entrega
          <AffixInput
            prefix="R$"
            inputMode="decimal"
            value={flatFee}
            onChange={(event) => {
              setFlatFee(event.target.value);
              touch();
            }}
            className="mt-1.5"
          />
        </label>
      )}

      {mode === 'by_zone' && (
        <div className="mt-5">
          <p className="text-sm text-muted">
            O bot só entrega nos bairros da lista. Bairros fora dela: o cliente pode retirar na loja.
          </p>
          {zones.length > 0 && (
            <div className={`mt-3 grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] gap-2 ${ROW_HEADER}`}>
              <span>Bairro</span>
              <span>Taxa</span>
            </div>
          )}
          <ul className="mt-2 space-y-2">
            {zones.map((zone, index) => (
              <li key={index} className="grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] items-center gap-2">
                <input
                  aria-label="Bairro"
                  placeholder="Bairro"
                  maxLength={80}
                  value={zone.neighborhood}
                  onChange={(event) => {
                    setZones(zones.map((row, i) => (i === index ? { ...row, neighborhood: event.target.value } : row)));
                    touch();
                  }}
                  className={`min-w-0 ${INPUT}`}
                />
                <AffixInput
                  prefix="R$"
                  aria-label="Taxa (R$)"
                  placeholder="0,00"
                  inputMode="decimal"
                  value={zone.fee}
                  onChange={(event) => {
                    setZones(zones.map((row, i) => (i === index ? { ...row, fee: event.target.value } : row)));
                    touch();
                  }}
                />
                <RemoveButton
                  label="Remover bairro"
                  onClick={() => {
                    setZones(zones.filter((_, i) => i !== index));
                    touch();
                  }}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setZones([...zones, { neighborhood: '', fee: '' }]);
              touch();
            }}
            className="mt-3 text-sm font-medium text-accent-fg hover:underline"
          >
            + Bairro
          </button>
        </div>
      )}

      {mode === 'by_distance' && (
        <div className="mt-5 space-y-4">
          <StoreLocationField location={location} />

          <div>
            <p className="text-sm text-muted">
              A distância é em linha reta até o cliente. Pelas ruas costuma ser 20–40% maior: ajuste as faixas com isso
              em mente. Acima da última faixa o bot não entrega e oferece retirada.
            </p>
            {bands.length > 0 && (
              <div className={`mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 ${ROW_HEADER}`}>
                <span>Até</span>
                <span>Taxa</span>
              </div>
            )}
            <ul className="mt-2 space-y-2">
              {bands.map((band, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2">
                  <AffixInput
                    suffix="km"
                    aria-label="Distância (km)"
                    placeholder="2"
                    inputMode="decimal"
                    value={band.km}
                    onChange={(event) => {
                      setBands(bands.map((row, i) => (i === index ? { ...row, km: event.target.value } : row)));
                      touch();
                    }}
                  />
                  <AffixInput
                    prefix="R$"
                    aria-label="Taxa (R$)"
                    placeholder="0,00"
                    inputMode="decimal"
                    value={band.fee}
                    onChange={(event) => {
                      setBands(bands.map((row, i) => (i === index ? { ...row, fee: event.target.value } : row)));
                      touch();
                    }}
                  />
                  <RemoveButton
                    label="Remover faixa"
                    onClick={() => {
                      setBands(bands.filter((_, i) => i !== index));
                      touch();
                    }}
                  />
                </li>
              ))}
            </ul>
            {bands.length < 10 && (
              <button
                type="button"
                onClick={() => {
                  setBands([...bands, { km: '', fee: '' }]);
                  touch();
                }}
                className="mt-3 text-sm font-medium text-accent-fg hover:underline"
              >
                + Faixa
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Store address found by Google (origin of the distance). Saved on "Localizar", outside the delivery form.
 */
function StoreLocationField({ location }: { location: StoreLocation | null }) {
  const locate = useLocateStore();
  const [address, setAddress] = useState(location?.address ?? '');
  const current = locate.data?.store_location ?? location;

  const notFound = locate.error instanceof ApiError && locate.error.status === 400;

  return (
    <div className="rounded-xl border border-line bg-hover p-3.5 text-sm">
      <span className="font-medium">Endereço da loja</span>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          value={address}
          maxLength={200}
          aria-label="Endereço da loja"
          placeholder="Rua, número, bairro, cidade"
          onChange={(event) => {
            setAddress(event.target.value);
            locate.reset();
          }}
          className={`min-w-0 flex-1 basis-56 bg-surface ${INPUT}`}
        />
        <button
          type="button"
          disabled={locate.isPending || !address.trim()}
          onClick={() => locate.mutate({ address: address.trim() })}
          className="rounded-lg border border-line-2 bg-surface px-3 py-2 font-medium disabled:opacity-50"
        >
          {locate.isPending ? 'Localizando…' : 'Localizar'}
        </button>
      </div>
      {notFound && <p className="mt-2 text-danger-fg">Endereço não encontrado. Inclua rua, número e cidade.</p>}
      {locate.isError && !notFound && (
        <p className="mt-2 text-danger-fg">O serviço de mapas não respondeu. Tente novamente.</p>
      )}
      {current ? (
        <p className="mt-2 break-words text-muted">
          Encontrado: {current.address}{' '}
          <a
            href={`https://www.google.com/maps?q=${current.latitude},${current.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent-fg hover:underline"
          >
            ver no mapa
          </a>
        </p>
      ) : (
        <p className="mt-2 text-warn-fg">Localize o endereço da loja: é o ponto de partida da distância.</p>
      )}
    </div>
  );
}

const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'card', 'cash', 'voucher'];

function PaymentSection({ methods }: { methods: PaymentMethod[] }) {
  const update = useUpdatePayment();
  const [selected, setSelected] = useState<PaymentMethod[]>(methods);

  const toggle = (method: PaymentMethod) => {
    setSelected(
      selected.includes(method)
        ? selected.filter((item) => item !== method)
        : PAYMENT_METHODS.filter((item) => item === method || selected.includes(item))
    );
    update.reset();
  };

  return (
    <Section
      title="Pagamento"
      description="O bot só oferece as formas marcadas. Pagamento na entrega ou na retirada."
      onSubmit={() => update.mutate({ payment_methods: selected })}
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
      invalid={selected.length ? undefined : 'Escolha pelo menos uma forma.'}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {PAYMENT_METHODS.map((method) => {
          const on = selected.includes(method);

          return (
            <button
              key={method}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(method)}
              className={`flex items-center gap-2.5 rounded-xl border-[1.5px] p-3.5 text-left text-sm font-medium ${
                on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-2'
              }`}
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs ${
                  on ? 'bg-accent text-white' : 'border border-line-2 bg-surface'
                }`}
              >
                {on && '✓'}
              </span>
              {PAYMENT_LABEL[method]}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

type LimitKey = Exclude<
  keyof PolicySettings,
  | 'sop'
  | 'previous_address'
  | 'repeat_order_statuses'
  | 'delivery_min_minutes'
  | 'delivery_max_minutes'
  | 'new_order_after_status'
  | 'add_on_category_ids'
  | 'add_on_extra_minutes'
>;

type DeliveryTimeMode = 'approx' | 'range';

/**
 * "Aproximado" is stored as the same value in both ends; a range has two different values.
 */
const deliveryTimeMode = (policy: PolicySettings): DeliveryTimeMode =>
  policy.delivery_min_minutes != null &&
  policy.delivery_max_minutes != null &&
  policy.delivery_min_minutes !== policy.delivery_max_minutes
    ? 'range'
    : 'approx';

const LIMITS: { key: LimitKey; label: string; hint: string; money: boolean; unit?: string }[] = [
  {
    key: 'min_order_cents',
    label: 'Pedido mínimo',
    hint: 'Sem itens suficientes, o bot pede para completar.',
    money: true
  },
  { key: 'max_order_cents', label: 'Pedido máximo', hint: 'Acima disso, o bot pede sua aprovação.', money: true },
  { key: 'max_change_cents', label: 'Troco máximo', hint: 'Troco acima disso é recusado.', money: true },
  {
    key: 'max_item_qty',
    label: 'Quantidade máxima por item',
    hint: 'Acima disso, o bot pede sua aprovação.',
    money: false,
    unit: 'un.'
  },
  {
    key: 'new_customer_review_cents',
    label: 'Revisar 1º pedido acima de',
    hint: 'Primeiro pedido de cliente novo acima disso espera sua aprovação.',
    money: true
  },
  {
    key: 'last_order_minutes',
    label: 'Parar pedidos antes de fechar',
    hint: 'Minutos antes do fechamento em que o bot para de aceitar.',
    money: false,
    unit: 'min'
  }
];

const SOP_MAX_LENGTH = 2000;

const ADDRESS_MODES: { value: PreviousAddress; title: string; example: string }[] = [
  {
    value: 'ask',
    title: 'Perguntar logo',
    example: 'Na entrega, o bot já pergunta: "Entrego na Rua das Flores, 10 de novo?"'
  },
  {
    value: 'on_request',
    title: 'Só se o cliente pedir',
    example: 'O bot pede o endereço; se o cliente disser "manda no mesmo da última vez", ele usa o anterior.'
  }
];

const REPEAT_STATUSES: OrderStatus[] = ['done', 'canceled', 'abandoned', 'out', 'accepted', 'placed'];

const NEW_ORDER_MODES: { value: NewOrderAfterStatus; title: string; example: string }[] = [
  {
    value: 'done',
    title: 'Só depois de concluído (padrão)',
    example: 'Um pedido por vez. Em preparo, o cliente só acrescenta o que você permitir abaixo.'
  },
  {
    value: 'out',
    title: 'Depois que sair',
    example: 'Enquanto está em preparo, só acréscimos.'
  },
  {
    value: 'accepted',
    title: 'Depois que a loja aceitar',
    example: 'Antes disso, o que o cliente pedir entra no mesmo pedido.'
  }
];

/**
 * Same rule as the API's `isDrinkCategory` (`src/orders/in-progress.ts`): the add-on categories when the store
 * never chose.
 */
const isDrinkCategory = (name: string) => {
  const normalized = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  return ['bebida', 'drink', 'refri', 'suco', 'cerveja'].some((word) => normalized.includes(word));
};

const limitToInput = (value: number | null, money: boolean) => {
  if (value === null) {
    return '';
  }

  return money ? centsToInput(value) : String(value);
};

/**
 * Empty = no limit (`null`); `undefined` = not a valid value.
 */
const parseLimit = (text: string, money: boolean) => {
  if (!text.trim()) {
    return null;
  }

  if (money) {
    return parseMoney(text);
  }

  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
};

function PolicySection({ policy }: { policy: PolicySettings }) {
  const update = useUpdatePolicy();
  const [values, setValues] = useState<Record<LimitKey, string>>(
    () =>
      Object.fromEntries(LIMITS.map(({ key, money }) => [key, limitToInput(policy[key], money)])) as Record<
        LimitKey,
        string
      >
  );
  const [sop, setSop] = useState(policy.sop ?? '');
  const [timeMode, setTimeMode] = useState(() => deliveryTimeMode(policy));
  const [timeFrom, setTimeFrom] = useState(
    limitToInput(policy.delivery_min_minutes ?? policy.delivery_max_minutes, false)
  );
  const [timeTo, setTimeTo] = useState(limitToInput(policy.delivery_max_minutes, false));
  const [previousAddress, setPreviousAddress] = useState<PreviousAddress>(policy.previous_address ?? 'ask');
  const [repeatStatuses, setRepeatStatuses] = useState<OrderStatus[]>(policy.repeat_order_statuses ?? []);
  const repeat = repeatStatuses.length > 0;
  const [newOrderAfter, setNewOrderAfter] = useState<NewOrderAfterStatus>(policy.new_order_after_status ?? 'done');
  // Null until the store picks: the default keeps following the drink categories.
  const [addOnIds, setAddOnIds] = useState<string[] | null>(policy.add_on_category_ids);
  const [extraMinutes, setExtraMinutes] = useState(limitToInput(policy.add_on_extra_minutes, false));
  const extra = parseLimit(extraMinutes, false);

  const changeRepeat = (statuses: OrderStatus[]) => {
    setRepeatStatuses(statuses);
    update.reset();
  };

  const parsed = LIMITS.map(({ key, money, label }) => ({ key, label, value: parseLimit(values[key], money) }));
  const wrong = parsed.find(({ value }) => value === undefined);
  const from = parseLimit(timeFrom, false);
  const to = timeMode === 'range' ? parseLimit(timeTo, false) : from;

  const timeInvalid =
    from === undefined || to === undefined
      ? 'Valor inválido em "Tempo de entrega".'
      : timeMode === 'range' && (from === null) !== (to === null)
        ? 'Preencha os dois valores do intervalo.'
        : from != null && to != null && from > to
          ? 'No intervalo, o primeiro tempo deve ser menor.'
          : extra === undefined
            ? 'Valor inválido em "Tempo extra".'
            : undefined;

  const save = () =>
    update.mutate({
      ...Object.fromEntries(parsed.map(({ key, value }) => [key, value])),
      sop: sop.trim() ? sop : null,
      delivery_min_minutes: from ?? null,
      delivery_max_minutes: to ?? null,
      previous_address: previousAddress,
      repeat_order_statuses: repeatStatuses,
      new_order_after_status: newOrderAfter,
      add_on_category_ids: addOnIds,
      add_on_extra_minutes: extra ?? null
    });

  return (
    <Section
      title="Regras"
      description="Deixe em branco para não ter limite."
      onSubmit={save}
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
      invalid={wrong ? `Valor inválido em "${wrong.label}".` : timeInvalid}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {LIMITS.map(({ key, label, hint, money, unit }) => (
          <label key={key} className="block text-sm font-medium">
            {label}
            <AffixInput
              prefix={money ? 'R$' : undefined}
              suffix={unit}
              placeholder="Sem limite"
              inputMode={money ? 'decimal' : 'numeric'}
              value={values[key]}
              onChange={(event) => {
                setValues({ ...values, [key]: event.target.value });
                update.reset();
              }}
              className="mt-1.5"
            />
            <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>
          </label>
        ))}
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Tempo de entrega</legend>
        <span className="mt-1 block text-xs text-muted">
          O bot informa quando o cliente pergunta, e vira resposta rápida na conversa. Em branco: o bot diz que a loja
          confirma o tempo.
        </span>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="grid grid-cols-2 rounded-lg bg-seg p-[3px]">
            {(['approx', 'range'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTimeMode(value);
                  update.reset();
                }}
                className={`h-8 rounded-md px-3 text-[13px] ${timeMode === value ? 'bg-seg-on font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted'}`}
              >
                {value === 'approx' ? 'Aproximado' : 'Intervalo'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {timeMode === 'range' && <span className="text-muted">de</span>}
            <AffixInput
              suffix="min"
              placeholder={timeMode === 'range' ? '30' : '40'}
              inputMode="numeric"
              value={timeFrom}
              onChange={(event) => {
                setTimeFrom(event.target.value);
                update.reset();
              }}
              className="w-28"
            />
            {timeMode === 'range' && (
              <>
                <span className="text-muted">a</span>
                <AffixInput
                  suffix="min"
                  placeholder="50"
                  inputMode="numeric"
                  value={timeTo}
                  onChange={(event) => {
                    setTimeTo(event.target.value);
                    update.reset();
                  }}
                  className="w-28"
                />
              </>
            )}
          </div>
        </div>
        <span className="mt-1.5 block text-xs text-muted">
          {timeMode === 'approx'
            ? 'Exemplo: "O tempo de entrega é de aproximadamente 40 minutos."'
            : 'Exemplo: "O tempo de entrega é de 30 a 50 minutos."'}
        </span>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Endereço da última entrega</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {ADDRESS_MODES.map(({ value, title, example }) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm ${previousAddress === value ? 'border-accent bg-accent-soft' : 'border-line-2'}`}
            >
              <input
                type="radio"
                name="previous_address"
                checked={previousAddress === value}
                onChange={() => {
                  setPreviousAddress(value);
                  update.reset();
                }}
                className="mt-0.5 accent-(--color-accent)"
              />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{title}</span>
                <span className="text-xs text-muted">{example}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Oferecer repetir o último pedido</span>
            <span className="text-xs text-muted">
              No início de um novo pedido, o bot pergunta: &quot;Quer repetir o da última vez: 1 Pizza Grande Calabresa
              e 1 Coca-Cola 2L?&quot; Os preços são os de hoje.
            </span>
          </span>
          <Toggle
            checked={repeat}
            label="Oferecer repetir o último pedido"
            onChange={(checked) => changeRepeat(checked ? ['done'] : [])}
          />
        </div>

        {repeat && (
          <fieldset className="mt-3">
            <legend className="text-xs text-muted">Quando o último pedido ficou:</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REPEAT_STATUSES.map((status) => {
                const checked = repeatStatuses.includes(status);

                return (
                  <label
                    key={status}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${checked ? 'border-accent bg-accent-soft text-accent-fg' : 'border-line-2 text-fg-2'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      // At least one status: turning the last one off is the switch's job.
                      disabled={checked && repeatStatuses.length === 1}
                      onChange={() =>
                        changeRepeat(
                          checked ? repeatStatuses.filter((value) => value !== status) : [...repeatStatuses, status]
                        )
                      }
                      className="sr-only"
                    />
                    {STATUS_LABEL[status]}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Novo pedido enquanto outro não terminou</legend>
        <span className="mt-1 block text-xs text-muted">
          A partir de quando o cliente pode fazer outro pedido. Antes da loja aceitar, o bot sempre altera o pedido que
          já foi enviado.
        </span>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {NEW_ORDER_MODES.map(({ value, title, example }) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm ${newOrderAfter === value ? 'border-accent bg-accent-soft' : 'border-line-2'}`}
            >
              <input
                type="radio"
                name="new_order_after_status"
                checked={newOrderAfter === value}
                onChange={() => {
                  setNewOrderAfter(value);
                  update.reset();
                }}
                className="mt-0.5 accent-(--color-accent)"
              />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{title}</span>
                <span className="text-xs text-muted">{example}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <AddOnFields
        ids={addOnIds}
        onChange={(ids) => {
          setAddOnIds(ids);
          update.reset();
        }}
        extraMinutes={extraMinutes}
        onExtraMinutes={(value) => {
          setExtraMinutes(value);
          update.reset();
        }}
      />

      <label className="mt-6 block text-sm font-medium">
        Instruções para o bot
        <span className="mt-1 block text-xs font-normal text-muted">
          Regras da casa em texto livre, por exemplo: &quot;Não aceitamos meia de pizza doce com salgada.&quot;
        </span>
        <textarea
          value={sop}
          maxLength={SOP_MAX_LENGTH}
          rows={5}
          onChange={(event) => {
            setSop(event.target.value);
            update.reset();
          }}
          className={`mt-2 block w-full resize-y font-normal ${INPUT}`}
        />
        <span className="mt-1 block text-right text-xs font-normal text-muted">
          {sop.length}/{SOP_MAX_LENGTH}
        </span>
      </label>
    </Section>
  );
}

/**
 * What the customer may still add while the store prepares the order (`add_to_order`), and the delay the bot quotes.
 */
function AddOnFields(props: {
  ids: string[] | null;
  onChange: (ids: string[]) => void;
  extraMinutes: string;
  onExtraMinutes: (value: string) => void;
}) {
  const menu = useMenu();
  const categories: MenuCategory[] = menu.data?.categories ?? [];
  const selected = props.ids ?? categories.filter(({ name }) => isDrinkCategory(name)).map(({ id }) => id);

  return (
    <fieldset className="mt-6">
      <legend className="text-sm font-medium">Acréscimos em pedido em preparo</legend>
      <span className="mt-1 block text-xs text-muted">
        Depois que você aceitar, o cliente ainda pode acrescentar itens destas categorias. O bot confirma o item, o
        valor e avisa do tempo extra. Remover ou trocar itens continua com um atendente.
      </span>

      {menu.isPending && <span className="mt-2 block text-xs text-muted">Carregando categorias…</span>}
      {!menu.isPending && !categories.length && (
        <span className="mt-2 block text-xs text-muted">Cadastre categorias no cardápio para escolher.</span>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {categories.map(({ id, name }) => {
          const checked = selected.includes(id);

          return (
            <label
              key={id}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${checked ? 'border-accent bg-accent-soft text-accent-fg' : 'border-line-2 text-fg-2'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => props.onChange(checked ? selected.filter((value) => value !== id) : [...selected, id])}
                className="sr-only"
              />
              {name}
            </label>
          );
        })}
      </div>

      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        Tempo extra para avisar
        <AffixInput
          suffix="min"
          placeholder="—"
          inputMode="numeric"
          value={props.extraMinutes}
          onChange={(event) => props.onExtraMinutes(event.target.value)}
          className="w-28"
        />
        <span className="text-xs text-muted">Em branco: o bot diz que pode levar alguns minutos a mais.</span>
      </label>
    </fieldset>
  );
}
