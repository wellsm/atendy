import { useState } from 'react';

import { pinErrorText } from './lock-screen';
import { PinPad } from './pin-pad';
import { useApi } from '../../lib/api';
import { useStaffLock } from '../../lib/queries';

const ACTION_LABEL: Record<string, string> = {
  pos_cancel: 'Cancelar venda',
  pos_discount_over_limit: 'Desconto acima do limite',
  cash_move: 'Movimento de caixa',
  cash_close: 'Fechar caixa',
  orders_cancel: 'Cancelar pedido',
  courier_settle: 'Acerto do entregador'
};

/**
 * "PIN do gerente": a manager picks their name and types the PIN; the action then runs once with that approval.
 */
export function ApprovalPrompt({
  permission,
  onApproved,
  onCancel
}: {
  permission: string;
  onApproved: (token: string) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const lock = useStaffLock();
  const managers = lock.data?.staff.filter(({ role }) => role === 'manager') ?? [];
  const [managerId, setManagerId] = useState<string>();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const picked = managers.find(({ id }) => id === (managerId ?? (managers.length === 1 ? managers[0]!.id : undefined)));

  const submit = async (next: string) => {
    setBusy(true);

    try {
      const data = await api<{ approval_token: string }>('POST', '/panel/staff/approvals', {
        staff_id: picked!.id,
        pin: next,
        permission
      });

      onApproved(data.approval_token);
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="PIN do gerente"
        className="flex max-h-full w-full max-w-sm flex-col items-center gap-4 overflow-y-auto rounded-2xl bg-surface p-6 text-fg"
      >
        <h2 className="text-lg font-bold">PIN do gerente</h2>
        <p className="text-center text-sm text-muted">
          {ACTION_LABEL[permission] ?? 'Esta ação'} precisa de um gerente.
        </p>

        {managers.length === 0 && <p className="text-sm text-danger-fg">Nenhum gerente cadastrado.</p>}

        {managers.length > 1 && (
          <div className="flex flex-wrap justify-center gap-2">
            {managers.map((manager) => (
              <button
                key={manager.id}
                type="button"
                onClick={() => {
                  setManagerId(manager.id);
                  setPin('');
                  setError(undefined);
                }}
                className={`rounded-full px-3.5 py-1.5 text-sm ${picked?.id === manager.id ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2'}`}
              >
                {manager.name}
              </button>
            ))}
          </div>
        )}

        {managers.length === 1 && <p className="text-sm font-medium">{managers[0]!.name}</p>}

        {picked && <PinPad value={pin} disabled={busy} onChange={change} />}
        <p className="min-h-5 text-sm text-danger-fg">{error}</p>

        <button type="button" onClick={onCancel} className="text-sm text-muted">
          Cancelar
        </button>
      </div>
    </div>
  );
}
