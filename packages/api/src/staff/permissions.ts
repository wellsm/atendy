import { StaffRole } from './types';

/**
 * What a panel write needs when the store is locked (spec `docs/specs/staff.md`, Goal 3).
 */
export const enum Permission {
  PosSell = 'pos_sell',
  PosCancel = 'pos_cancel',
  PosDiscountOverLimit = 'pos_discount_over_limit',
  CashOpen = 'cash_open',
  CashMove = 'cash_move',
  CashClose = 'cash_close',
  OrdersBoard = 'orders_board',
  OrdersCancel = 'orders_cancel',
  CourierDispatch = 'courier_dispatch',
  CourierSettle = 'courier_settle',
  Conversations = 'conversations',
  MenuAvailability = 'menu_availability',
  MenuEdit = 'menu_edit',
  StockMove = 'stock_move',
  StockManage = 'stock_manage',
  Settings = 'settings'
}

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  [StaffRole.Cashier]: [
    Permission.PosSell,
    Permission.CashOpen,
    Permission.OrdersBoard,
    Permission.CourierDispatch,
    Permission.Conversations,
    Permission.MenuAvailability,
    Permission.StockMove
  ],
  [StaffRole.Kitchen]: [Permission.OrdersBoard, Permission.CourierDispatch, Permission.MenuAvailability],
  [StaffRole.Manager]: [
    Permission.PosSell,
    Permission.PosCancel,
    Permission.PosDiscountOverLimit,
    Permission.CashOpen,
    Permission.CashMove,
    Permission.CashClose,
    Permission.OrdersBoard,
    Permission.OrdersCancel,
    Permission.CourierDispatch,
    Permission.CourierSettle,
    Permission.Conversations,
    Permission.MenuAvailability,
    Permission.MenuEdit,
    Permission.StockMove,
    Permission.StockManage,
    Permission.Settings
  ],
  [StaffRole.Courier]: []
};

/**
 * "Manager PIN" actions: a role without them may still run one with a manager's approval.
 */
export const APPROVABLE: Permission[] = [
  Permission.PosCancel,
  Permission.PosDiscountOverLimit,
  Permission.CashMove,
  Permission.CashClose,
  Permission.OrdersCancel,
  Permission.CourierSettle
];
