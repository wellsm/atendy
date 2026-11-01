export const enum StaffRole {
  Cashier = 'cashier',
  Kitchen = 'kitchen',
  Manager = 'manager',
  Courier = 'courier'
}

/**
 * What the panel and other modules may see of an employee: never the PIN hash nor the courier link token.
 */
export type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  delivers: boolean;
  phone: string | null;
  active: boolean;
};
