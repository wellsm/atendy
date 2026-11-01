import type { StaffMember, StaffRole } from './queries';

export const ROLE_LABEL: Record<StaffRole, string> = {
  cashier: 'Caixa',
  kitchen: 'Cozinha',
  manager: 'Gerente',
  courier: 'Entregador'
};

/**
 * Name of the author id a record carries: an employee id, or a Clerk user id (`user_…`), which is the owner.
 */
export const authorName = (id: string | null | undefined, staff: StaffMember[] | undefined) => {
  if (!id) {
    return undefined;
  }

  return staff?.find((member) => member.id === id)?.name ?? (id.startsWith('user_') ? 'Dono' : undefined);
};
