import type { OperatorHeaders } from '../../src/staff/authorize';
import type { ApprovalClaims, OperatorClaims } from '../../src/staff/tokens';

import { signApproval, signOperator } from '../../src/staff/tokens';

/**
 * The `x-operator` (and optional `x-approval`) headers the web sends, with real signed tokens.
 */
export const operatorHeaders = (
  operator: Omit<OperatorClaims, 'expiresAt'>,
  approval?: Omit<ApprovalClaims, 'expiresAt'>
): OperatorHeaders => ({
  'x-operator': signOperator(operator),
  ...(approval && { 'x-approval': signApproval(approval) })
});
