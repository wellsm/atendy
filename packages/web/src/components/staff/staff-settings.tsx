import type { FormEvent } from 'react';
import type { StaffMember, StaffRole, StaffSettings } from '../../lib/queries';

import { useEffect, useState } from 'react';

import { ApiError } from '../../lib/api';
import {
  useCreateStaff,
  useRegenerateCourierLink,
  useSetStaffPin,
  useStaff,
  useUpdateStaff,
  useUpdateStaffSettings
} from '../../lib/queries';
import { ROLE_LABEL } from '../../lib/staff';
import { Loading } from '../loading';
import { CourierSettlement } from './courier-settlement';

const INPUT =
  'rounded-lg border border-line-2 px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:bg-hover';

const BUTTON = 'h-9 rounded-lg border border-line-2 px-3 text-[13px] font-medium hover:bg-hover disabled:opacity-50';

const FIELD_ERROR: Record<string, string> = {
  name: 'O nome precisa ter de 1 a 80 caracteres.',
  pin: 'O PIN precisa ter 4 números.',
  phone: 'Informe o WhatsApp com DDD.',
  role: 'Confira o perfil escolhido.',
  blocked: 'Muitas tentativas de PIN. Aguarde alguns minutos.',
  idle_minutes: 'O tempo precisa ficar entre 1 e 240 minutos.',
  discount_limit_percent: 'O desconto precisa ficar entre 0 e 100 %.',
  courier_fee_mode: 'Escolha como pagar o entregador.',
  courier_fee_cents: 'O valor precisa ser positivo.'
};

const errorText = (error: unknown, creating = false) => {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.field === 'manager_required') {
      return creating ? 'Cadastre um gerente antes.' : 'É o último gerente.';
    }

    if (error.field === 'forbidden') {
      return 'Sem permissão.';
    }

    if (error.status === 400 && error.field && FIELD_ERROR[error.field]) {
      return FIELD_ERROR[error.field];
    }
  }

  return 'Não foi possível salvar. Tente novamente.';
};

const ROLES: StaffRole[] = ['cashier', 'kitchen', 'manager', 'courier'];

type Draft = { name: string; role: StaffRole; pin: string; delivers: boolean; phone: string };

const toDraft = (member?: StaffMember): Draft => ({
  name: member?.name ?? '',
  role: member?.role ?? 'cashier',
  pin: '',
  delivers: member?.delivers ?? false,
  phone: member?.phone ?? ''
});

/**
 * Create (no `member`) or edit an employee. The PIN is asked on create and when a courier becomes a PIN role.
 */
function EmployeeForm({ member, onDone }: { member?: StaffMember; onDone: () => void }) {
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const [draft, setDraft] = useState(() => toDraft(member));
  const mutation = member ? update : create;
  const pinRole = draft.role !== 'courier';
  const needsPin = pinRole && (!member || member.role === 'courier');
  const delivers = draft.role === 'courier' || draft.delivers;

  const change = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    mutation.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const body = {
      name: draft.name.trim(),
      role: draft.role,
      delivers,
      phone: delivers ? draft.phone.trim() : null,
      ...(needsPin && { pin: draft.pin })
    };

    if (member) {
      update.mutate({ id: member.id, body: { ...body, active: member.active } }, { onSuccess: onDone });
    } else {
      create.mutate(body, { onSuccess: onDone });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nome
        <input
          value={draft.name}
          maxLength={80}
          autoFocus
          onChange={(event) => change({ name: event.target.value })}
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Perfil
        <select
          value={draft.role}
          onChange={(event) => change({ role: event.target.value as StaffRole })}
          className={INPUT}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
      </label>

      {needsPin && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          PIN (4 números)
          <input
            value={draft.pin}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            onChange={(event) => change({ pin: event.target.value.replace(/\D/g, '') })}
            className={INPUT}
          />
        </label>
      )}

      {pinRole && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.delivers}
            onChange={(event) => change({ delivers: event.target.checked })}
          />
          Faz entregas
        </label>
      )}

      {delivers && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          WhatsApp
          <input
            value={draft.phone}
            inputMode="tel"
            placeholder="(11) 99999-9999"
            onChange={(event) => change({ phone: event.target.value })}
            className={INPUT}
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending || !draft.name.trim() || (needsPin && draft.pin.length !== 4)}
          className="h-[38px] rounded-lg bg-accent px-[18px] text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-muted">
          Cancelar
        </button>
        {mutation.isError && <span className="text-sm text-danger-fg">{errorText(mutation.error, !member)}</span>}
      </div>
    </form>
  );
}

/**
 * A new PIN; with `reactivate` it also turns the employee back on (deactivation dropped the old PIN).
 */
function ChangePin({ member, reactivate, onDone }: { member: StaffMember; reactivate?: boolean; onDone: () => void }) {
  const changePin = useSetStaffPin();
  const update = useUpdateStaff();
  const setPin = reactivate ? update : changePin;
  const [pin, setValue] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (reactivate) {
          const { name, role, delivers, phone } = member;

          update.mutate(
            { id: member.id, body: { name, role, delivers, phone, pin, active: true } },
            { onSuccess: onDone }
          );
        } else {
          changePin.mutate({ id: member.id, pin }, { onSuccess: onDone });
        }
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        value={pin}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        autoFocus
        placeholder="Novo PIN"
        aria-label={`Novo PIN de ${member.name}`}
        onChange={(event) => {
          setValue(event.target.value.replace(/\D/g, ''));
          setPin.reset();
        }}
        className={`w-28 ${INPUT}`}
      />
      <button type="submit" disabled={pin.length !== 4 || setPin.isPending} className={BUTTON}>
        {reactivate ? 'Reativar' : 'Salvar PIN'}
      </button>
      <button type="button" onClick={onDone} className="text-sm text-muted">
        Cancelar
      </button>
      {setPin.isError && <span className="text-sm text-danger-fg">{errorText(setPin.error)}</span>}
    </form>
  );
}

/**
 * "Gerar novo link": the token is returned once, so "Copiar link" exists only right after generating.
 */
function CourierLink({ member }: { member: StaffMember }) {
  const regenerate = useRegenerateCourierLink();
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link!);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={regenerate.isPending}
        onClick={() =>
          regenerate.mutate(
            { id: member.id },
            {
              onSuccess: ({ token }) => {
                setLink(`${window.location.origin}/courier/${token}`);
                setCopied(false);
              }
            }
          )
        }
        className={BUTTON}
      >
        Gerar novo link
      </button>
      {link && (
        <>
          <button type="button" onClick={() => void copy()} className={BUTTON}>
            {copied ? 'Copiado' : 'Copiar link'}
          </button>
          <span className="text-xs text-muted">
            O link anterior deixou de funcionar. Copie agora: ele não aparece de novo.
          </span>
        </>
      )}
      {regenerate.isError && <span className="text-sm text-danger-fg">{errorText(regenerate.error)}</span>}
    </div>
  );
}

function EmployeeRow({ member }: { member: StaffMember }) {
  const update = useUpdateStaff();
  const [mode, setMode] = useState<'edit' | 'pin' | 'settle' | 'reactivate'>();
  const hasLink = member.role === 'courier' || member.delivers;

  if (mode === 'edit') {
    return <EmployeeForm member={member} onDone={() => setMode(undefined)} />;
  }

  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${member.active ? '' : 'text-muted'}`}>
          {member.name}
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-2">
          {ROLE_LABEL[member.role]}
        </span>
        {member.role !== 'courier' && member.delivers && (
          <span className="rounded-full bg-out-bg px-2 py-0.5 text-xs font-medium text-out-fg">Entrega</span>
        )}
        {!member.active && <span className="text-xs text-muted">Inativo</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode('edit')} className={BUTTON}>
          Editar
        </button>
        {member.role !== 'courier' && member.active && (
          <button type="button" onClick={() => setMode('pin')} className={BUTTON}>
            Trocar PIN
          </button>
        )}
        {/* Also inactive: a deactivated courier may still have deliveries to settle. */}
        {hasLink && (
          <button type="button" onClick={() => setMode(mode === 'settle' ? undefined : 'settle')} className={BUTTON}>
            Acerto
          </button>
        )}
        <button
          type="button"
          disabled={update.isPending}
          onClick={() =>
            // Reactivating a PIN role needs a new PIN (deactivation dropped it).
            !member.active && member.role !== 'courier'
              ? setMode(mode === 'reactivate' ? undefined : 'reactivate')
              : update.mutate({
                  id: member.id,
                  body: {
                    name: member.name,
                    role: member.role,
                    delivers: member.delivers,
                    phone: member.phone,
                    active: !member.active
                  }
                })
          }
          className={BUTTON}
        >
          {member.active ? 'Desativar' : 'Reativar'}
        </button>
      </div>

      {mode === 'settle' && <CourierSettlement member={member} />}
      {mode === 'pin' && <ChangePin member={member} onDone={() => setMode(undefined)} />}
      {mode === 'reactivate' && <ChangePin member={member} reactivate onDone={() => setMode(undefined)} />}
      {hasLink && member.active && <CourierLink member={member} />}
      {update.isError && <p className="text-sm text-danger-fg">{errorText(update.error)}</p>}
    </li>
  );
}

function Defaults({ settings }: { settings: StaffSettings }) {
  const update = useUpdateStaffSettings();
  const [value, setValue] = useState(settings);

  // A refetch (another device saved) replaces what the form shows.
  useEffect(
    () => setValue(settings),
    [settings.idle_minutes, settings.discount_limit_percent, settings.courier_fee_mode, settings.courier_fee_cents]
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(value);
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Travar após X minutos sem uso
        <input
          type="number"
          min={1}
          max={240}
          value={value.idle_minutes}
          onChange={(event) => {
            setValue({ ...value, idle_minutes: Number(event.target.value) });
            update.reset();
          }}
          className={`w-32 ${INPUT}`}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Desconto máximo do caixa (% da venda)
        <input
          type="number"
          min={0}
          max={100}
          value={value.discount_limit_percent}
          onChange={(event) => {
            setValue({ ...value, discount_limit_percent: Number(event.target.value) });
            update.reset();
          }}
          className={`w-32 ${INPUT}`}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Pagamento do entregador por entrega
        <select
          value={value.courier_fee_mode}
          onChange={(event) => {
            setValue({ ...value, courier_fee_mode: event.target.value as 'order_fee' | 'fixed' });
            update.reset();
          }}
          className={`w-64 ${INPUT}`}
        >
          <option value="order_fee">Taxa de entrega do pedido</option>
          <option value="fixed">Valor fixo</option>
        </select>
      </label>
      {value.courier_fee_mode === 'fixed' && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Valor fixo (R$)
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.courier_fee_cents / 100}
            onChange={(event) => {
              setValue({ ...value, courier_fee_cents: Math.round(Number(event.target.value) * 100) });
              update.reset();
            }}
            className={`w-32 ${INPUT}`}
          />
        </label>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={update.isPending}
          className="h-[38px] rounded-lg bg-accent px-[18px] text-sm font-medium text-white disabled:opacity-50"
        >
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        {update.isError && <span className="text-sm text-danger-fg">{errorText(update.error)}</span>}
        {update.isSuccess && <span className="text-sm text-ok-fg">✓ Salvo</span>}
      </div>
    </form>
  );
}

/**
 * Settings tab "Funcionários": lock timing and discount limit, then the employees (never deleted, only deactivated).
 */
export function StaffTab({ settings }: { settings: StaffSettings }) {
  const staff = useStaff();
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <p className="text-[13px] text-muted">
        Com pelo menos um funcionário com PIN, o painel pede &quot;Quem está usando?&quot; e libera cada tela pelo
        perfil.
      </p>

      <div className="mt-4">
        <Defaults settings={settings} />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <h3 className="flex-1 text-sm font-semibold">Funcionários</h3>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            Novo funcionário
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {adding && <EmployeeForm onDone={() => setAdding(false)} />}
        {staff.isPending && <Loading />}
        {staff.isError && <p className="text-sm text-danger-fg">Não foi possível carregar os funcionários.</p>}
        {staff.data?.staff.length === 0 && !adding && <p className="text-sm text-muted">Nenhum funcionário ainda.</p>}
        <ul className="flex flex-col gap-2.5">
          {staff.data?.staff.map((member) => (
            <EmployeeRow key={member.id} member={member} />
          ))}
        </ul>
      </div>
    </div>
  );
}
