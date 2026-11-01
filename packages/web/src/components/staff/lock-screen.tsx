import type { StaffLock } from '../../lib/queries';

import { useReverification } from '@clerk/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { PinPad } from './pin-pad';
import { ApiError, useApi } from '../../lib/api';
import { useOperator } from '../../lib/operator';
import { usePanelSlug } from '../../lib/panel-slug';
import { useStaffLock } from '../../lib/queries';
import { ROLE_LABEL } from '../../lib/staff';

type Person = StaffLock['staff'][number];

// The shape Clerk's `useReverification` reads as "ask the user to verify again, then retry".
const REVERIFY_HINT = {
  clerk_error: {
    type: 'forbidden',
    reason: 'reverification-error',
    metadata: { reverification: { level: 'first_factor', afterMinutes: 2 } }
  }
} as const;

/**
 * Ok when the answer says "wrong PIN" / "blocked", so the pad can show it.
 */
export const pinErrorText = (error: unknown) => {
  if (error instanceof ApiError && error.field === 'blocked') {
    return 'Muitas tentativas. Aguarde alguns minutos.';
  }

  if (error instanceof ApiError && error.field === 'pin') {
    return 'PIN incorreto.';
  }

  return 'Não foi possível confirmar. Tente novamente.';
};

/**
 * "Esqueci o PIN": the signed-in Clerk user verifies again (email code) and becomes a manager operator.
 */
function ForgotPin({ onBack }: { onBack: () => void }) {
  const api = useApi();
  const { signIn } = useOperator();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const unlockOwner = useReverification(async () => {
    try {
      return await api<{ operator_token: string }>('POST', '/panel/staff/owner-unlock', undefined, {
        skipCache: true
      });
    } catch (failure) {
      if (failure instanceof ApiError && failure.field === 'reverify') {
        return REVERIFY_HINT;
      }

      throw failure;
    }
  });

  const run = async () => {
    setBusy(true);
    setError(undefined);

    try {
      const { operator_token } = await unlockOwner();

      signIn(operator_token, { id: null, name: 'Dono', role: 'manager' });
    } catch {
      setError('Não foi possível confirmar sua identidade.');
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <p className="text-sm text-muted">
        Vamos confirmar que é você pela sua conta. Depois disso você entra como gerente e pode trocar os PINs em
        Configurações → Funcionários.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        Confirmar pela minha conta
      </button>
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <button type="button" onClick={onBack} className="text-sm text-muted">
        Voltar
      </button>
    </div>
  );
}

/**
 * "Quem está usando?": pick a name, type the PIN. Full screen; `onCancel` (an action asked for it) adds "Cancelar".
 */
export function LockScreen({ onCancel }: { onCancel?: () => void }) {
  const slug = usePanelSlug();
  const api = useApi();
  const lock = useStaffLock();
  const { signIn } = useOperator();
  const [picked, setPicked] = useState<Person>();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (next: string) => {
    setBusy(true);

    try {
      const data = await api<{ operator_token: string; operator: { id: string; name: string; role: Person['role'] } }>(
        'POST',
        '/panel/staff/unlock',
        { staff_id: picked!.id, pin: next }
      );

      signIn(data.operator_token, data.operator);
    } catch (failure) {
      setPin('');
      setError(pinErrorText(failure));
      setBusy(false);
    }
  };

  const change = (next: string) => {
    setPin(next);
    setError(undefined);

    if (next.length === 4 && picked && !busy) {
      void submit(next);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center gap-6 overflow-y-auto bg-page px-4 py-10 text-fg">
      <h1 className="text-2xl font-bold">Quem está usando?</h1>

      {lock.isError && <p className="text-sm text-danger-fg">Não foi possível carregar os funcionários.</p>}

      {forgot ? (
        <ForgotPin onBack={() => setForgot(false)} />
      ) : picked ? (
        <>
          <p className="text-base font-medium">{picked.name}</p>
          <PinPad value={pin} disabled={busy} onChange={change} />
          <p className="min-h-5 text-sm text-danger-fg">{error}</p>
          <button
            type="button"
            onClick={() => {
              setPicked(undefined);
              setPin('');
              setError(undefined);
            }}
            className="text-sm text-muted"
          >
            Trocar nome
          </button>
        </>
      ) : (
        <ul className="grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
          {lock.data?.staff.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => setPicked(person)}
                className="flex w-full flex-col items-center gap-1 rounded-xl border border-line bg-surface px-3 py-5 hover:bg-hover"
              >
                <span className="text-base font-semibold">{person.name}</span>
                <span className="text-xs text-muted">{ROLE_LABEL[person.role]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!forgot && (
        <div className="flex flex-col items-center gap-3 text-sm">
          <button type="button" onClick={() => setForgot(true)} className="font-medium text-accent-fg">
            Esqueci o PIN
          </button>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="text-muted">
              Cancelar
            </button>
          ) : (
            <Link to="/panel/$slug" params={{ slug }} search={{ view: 'orders' }} className="text-muted">
              Ver pedidos
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The operator's role cannot open this screen (also when typed in the URL).
 */
export function Denied() {
  const slug = usePanelSlug();
  const { lock } = useOperator();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-page p-6 text-center text-fg">
      <p className="text-lg font-semibold">Sem permissão</p>
      <p className="text-sm text-muted">Esta tela não está liberada para o seu perfil.</p>
      <Link
        to="/panel/$slug"
        params={{ slug }}
        search={{ view: 'orders' }}
        className="text-sm font-medium text-accent-fg"
      >
        Ver pedidos
      </Link>
      <button type="button" onClick={lock} className="text-sm text-muted">
        Trocar operador
      </button>
    </div>
  );
}
