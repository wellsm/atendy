import type { FormEvent, ReactNode } from 'react';
import type {
  DeliveryMode,
  DeliverySettings,
  HourRange,
  PaymentMethod,
  PolicySettings,
  Settings
} from '../../lib/queries';

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../../components/loading';
import { ApiError } from '../../lib/api';
import { centsToInput, parseMoney, PAYMENT_LABEL } from '../../lib/format';
import {
  useMe,
  useSettings,
  useUpdateDelivery,
  useUpdateHours,
  useUpdatePayment,
  useUpdatePolicy,
  useUpdateStore
} from '../../lib/queries';

export const Route = createFileRoute('/_panel/configuracoes')({
  component: SettingsPage
});

const INPUT =
  'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none disabled:bg-neutral-50';

/**
 * Portuguese text per API error field; the API messages are for developers.
 */
const FIELD_ERROR: Record<string, string> = {
  name: 'O nome precisa ter de 1 a 80 caracteres.',
  hours: 'Confira os horários: há intervalos sobrepostos ou inválidos.',
  flat_fee_cents: 'A taxa de entrega precisa ser zero ou mais.',
  zones: 'Confira os bairros: nomes repetidos, vazios ou taxa inválida.',
  payment_methods: 'Escolha pelo menos uma forma de pagamento.',
  sop: 'As instruções podem ter no máximo 2000 caracteres.'
};

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.status === 400) {
    return (error.field && FIELD_ERROR[error.field]) || 'Algum valor não é válido. Confira e tente de novo.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

function SettingsPage() {
  const settings = useSettings();

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Configurações</h1>

      <div className="mt-6 space-y-6">
        {settings.isPending && <Loading />}
        {settings.isError && <p className="text-sm text-red-700">Não foi possível carregar as configurações.</p>}
        {settings.data && <Sections settings={settings.data} />}
      </div>
    </section>
  );
}

function Sections({ settings }: { settings: Settings }) {
  return (
    <>
      <StoreSection />
      <HoursSection hours={settings.hours} />
      <DeliverySection delivery={settings.delivery} />
      <PaymentSection methods={settings.payment_methods} />
      <PolicySection policy={settings.policy} />
    </>
  );
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
    <form onSubmit={submit} className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="font-semibold">{props.title}</h2>
      {props.description && <p className="mt-1 text-sm text-neutral-500">{props.description}</p>}

      <div className="mt-4">{props.children}</div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={props.saving || !!props.invalid}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {props.saving ? 'Salvando…' : 'Salvar'}
        </button>
        {props.invalid && <span className="text-sm text-amber-700">{props.invalid}</span>}
        {!props.invalid && props.error != null && (
          <span className="text-sm text-red-700">{errorText(props.error)}</span>
        )}
        {!props.invalid && props.error == null && props.saved && <span className="text-sm text-green-700">Salvo</span>}
      </div>
    </form>
  );
}

function StoreSection() {
  const me = useMe();
  const update = useUpdateStore();
  const [name, setName] = useState(me.data?.store?.name ?? '');

  return (
    <Section
      title="Loja"
      onSubmit={() => update.mutate({ name: name.trim() })}
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
        className={`mt-1 w-full ${INPUT}`}
      />
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
      <ul className="divide-y divide-neutral-100">
        {WEEK.map(({ weekday, label }) => (
          <li key={weekday} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <span className="w-24 shrink-0 pt-2 text-sm font-medium">{label}</span>

            <div className="flex flex-1 flex-col gap-2">
              {days[weekday]!.length === 0 && <span className="pt-2 text-sm text-neutral-500">Fechado</span>}

              {days[weekday]!.map((range, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    required
                    aria-label={`${label}: abre`}
                    value={range.opens}
                    onChange={(event) => setRange(weekday, index, { opens: event.target.value })}
                    className={INPUT}
                  />
                  <span className="text-sm text-neutral-500">até</span>
                  <input
                    type="time"
                    required
                    aria-label={`${label}: fecha`}
                    value={range.closes}
                    onChange={(event) => setRange(weekday, index, { closes: event.target.value })}
                    className={INPUT}
                  />
                  {rangeHint(range) && <span className="text-xs text-neutral-500">{rangeHint(range)}</span>}
                  <button
                    type="button"
                    onClick={() => change({ ...days, [weekday]: days[weekday]!.filter((_, i) => i !== index) })}
                    className="text-sm text-neutral-500 hover:text-red-700"
                  >
                    Remover
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  onClick={() =>
                    change({ ...days, [weekday]: [...days[weekday]!, { opens: '18:00', closes: '23:00' }] })
                  }
                  className="font-medium text-red-700 hover:underline"
                >
                  Adicionar horário
                </button>
                {days[weekday]!.length > 0 && (
                  <button type="button" onClick={() => copyToAll(weekday)} className="text-neutral-600 hover:underline">
                    Copiar para todos os dias
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

type ZoneRow = { neighborhood: string; fee: string };

function DeliverySection({ delivery }: { delivery: DeliverySettings }) {
  const update = useUpdateDelivery();
  const [mode, setMode] = useState<DeliveryMode>(delivery.mode);
  const [flatFee, setFlatFee] = useState(centsToInput(delivery.flat_fee_cents));
  const [zones, setZones] = useState<ZoneRow[]>(() =>
    delivery.zones.map(({ neighborhood, fee_cents }) => ({ neighborhood, fee: centsToInput(fee_cents) }))
  );

  const touch = () => update.reset();

  const flatFeeCents = parseMoney(flatFee);
  const zoneFees = zones.map(({ fee }) => parseMoney(fee));

  const invalid =
    mode === 'flat'
      ? flatFeeCents === undefined
        ? 'Taxa inválida. Use por exemplo 5,00.'
        : undefined
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
      flat_fee_cents: flatFeeCents ?? 0,
      zones:
        mode === 'by_zone'
          ? zones.map(({ neighborhood }, index) => ({ neighborhood: neighborhood.trim(), fee_cents: zoneFees[index]! }))
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
      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            ['flat', 'Taxa fixa'],
            ['by_zone', 'Por bairro']
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="delivery-mode"
              checked={mode === value}
              onChange={() => {
                setMode(value);
                touch();
              }}
            />
            {label}
          </label>
        ))}
      </div>

      {mode === 'flat' ? (
        <label className="mt-4 block text-sm">
          <span className="font-medium">Taxa de entrega (R$)</span>
          <input
            inputMode="decimal"
            value={flatFee}
            onChange={(event) => {
              setFlatFee(event.target.value);
              touch();
            }}
            className={`mt-1 block w-32 ${INPUT}`}
          />
        </label>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-neutral-500">
            O bot só entrega nos bairros da lista. Bairros fora dela: o cliente pode retirar na loja.
          </p>
          <ul className="mt-3 space-y-2">
            {zones.map((zone, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Bairro"
                  placeholder="Bairro"
                  maxLength={80}
                  value={zone.neighborhood}
                  onChange={(event) => {
                    setZones(zones.map((row, i) => (i === index ? { ...row, neighborhood: event.target.value } : row)));
                    touch();
                  }}
                  className={`min-w-0 flex-1 ${INPUT}`}
                />
                <input
                  aria-label="Taxa (R$)"
                  placeholder="0,00"
                  inputMode="decimal"
                  value={zone.fee}
                  onChange={(event) => {
                    setZones(zones.map((row, i) => (i === index ? { ...row, fee: event.target.value } : row)));
                    touch();
                  }}
                  className={`w-28 ${INPUT}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setZones(zones.filter((_, i) => i !== index));
                    touch();
                  }}
                  className="text-sm text-neutral-500 hover:text-red-700"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setZones([...zones, { neighborhood: '', fee: '' }]);
              touch();
            }}
            className="mt-3 text-sm font-medium text-red-700 hover:underline"
          >
            Adicionar bairro
          </button>
        </div>
      )}
    </Section>
  );
}

const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'card', 'cash'];

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
      <div className="flex flex-wrap gap-4 text-sm">
        {PAYMENT_METHODS.map((method) => (
          <label key={method} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(method)} onChange={() => toggle(method)} />
            {PAYMENT_LABEL[method]}
          </label>
        ))}
      </div>
    </Section>
  );
}

type LimitKey = Exclude<keyof PolicySettings, 'sop'>;

const LIMITS: { key: LimitKey; label: string; hint: string; money: boolean }[] = [
  {
    key: 'min_order_cents',
    label: 'Pedido mínimo (R$)',
    hint: 'Sem itens suficientes, o bot pede para completar.',
    money: true
  },
  { key: 'max_order_cents', label: 'Pedido máximo (R$)', hint: 'Acima disso, passa para um atendente.', money: true },
  { key: 'max_change_cents', label: 'Troco máximo (R$)', hint: 'Troco acima disso é recusado.', money: true },
  {
    key: 'max_item_qty',
    label: 'Quantidade máxima por item',
    hint: 'Acima disso, passa para um atendente.',
    money: false
  },
  {
    key: 'new_customer_review_cents',
    label: 'Revisar 1º pedido acima de (R$)',
    hint: 'Primeiro pedido de cliente novo acima disso fica para a loja revisar.',
    money: true
  },
  {
    key: 'last_order_minutes',
    label: 'Parar pedidos antes de fechar (min)',
    hint: 'Minutos antes do fechamento em que o bot para de aceitar.',
    money: false
  }
];

const SOP_MAX_LENGTH = 2000;

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

  const parsed = LIMITS.map(({ key, money, label }) => ({ key, label, value: parseLimit(values[key], money) }));
  const wrong = parsed.find(({ value }) => value === undefined);

  const save = () =>
    update.mutate({
      ...Object.fromEntries(parsed.map(({ key, value }) => [key, value])),
      sop: sop.trim() ? sop : null
    });

  return (
    <Section
      title="Regras"
      description="Deixe em branco para não ter limite."
      onSubmit={save}
      saving={update.isPending}
      saved={update.isSuccess}
      error={update.error}
      invalid={wrong ? `Valor inválido em "${wrong.label}".` : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {LIMITS.map(({ key, label, hint, money }) => (
          <label key={key} className="block text-sm">
            <span className="font-medium">{label}</span>
            <input
              inputMode={money ? 'decimal' : 'numeric'}
              value={values[key]}
              onChange={(event) => {
                setValues({ ...values, [key]: event.target.value });
                update.reset();
              }}
              className={`mt-1 block w-full ${INPUT}`}
            />
            <span className="mt-1 block text-xs text-neutral-500">{hint}</span>
          </label>
        ))}
      </div>

      <label className="mt-5 block text-sm">
        <span className="font-medium">Instruções para o bot</span>
        <span className="mt-1 block text-xs text-neutral-500">
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
          className={`mt-2 block w-full resize-y ${INPUT}`}
        />
        <span className="mt-1 block text-right text-xs text-neutral-500">
          {sop.length}/{SOP_MAX_LENGTH}
        </span>
      </label>
    </Section>
  );
}
