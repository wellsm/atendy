import { Sheet } from './sheet';
import { useSettings } from '../../lib/queries';
import { Loading } from '../loading';
import { StaffTab } from '../staff/staff-settings';

/**
 * Employees, PINs, couriers and their access rules, in their own sheet (`?sheet=staff`).
 */
export function StaffSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();

  return (
    <Sheet width="md" label="Funcionários" onClose={onClose}>
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-4 md:px-6">
        <h2 className="flex-1 text-lg font-bold">Funcionários</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="size-9 shrink-0 rounded-full bg-surface-2 text-fg-2 hover:bg-line"
        >
          ✕
        </button>
      </div>
      {settings.isPending && <Loading />}
      {settings.isError && <p className="p-6 text-sm text-danger-fg">Não foi possível carregar os funcionários.</p>}
      {settings.data && <StaffTab settings={settings.data.staff} />}
    </Sheet>
  );
}
