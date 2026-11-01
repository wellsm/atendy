import { useAuth } from '@clerk/react';
import { useCallback } from 'react';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    /**
     * Message of a 4xx error body (`{ message, context: { field } }`), when the API sent one.
     */
    public readonly detail?: string,
    public readonly field?: string,
    /**
     * `context.names` of an `items` error: the products/options that are sold out or ran out.
     */
    public readonly names?: string[]
  ) {
    super(`API request failed (${status})`);
  }
}

const readError = async (response: Response) => {
  const body = (await response.json().catch(() => ({}))) as {
    message?: unknown;
    context?: { field?: unknown; names?: unknown };
  };
  const names = body.context?.names;

  return new ApiError(
    response.status,
    typeof body.message === 'string' ? body.message : undefined,
    typeof body.context?.field === 'string' ? body.context.field : undefined,
    Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : undefined
  );
};

const API_URL = import.meta.env.VITE_API_URL as string;

/**
 * What the store panel's `OperatorProvider` lends to every API call (spec `docs/specs/staff.md`): the operator token,
 * and how to ask "Quem está usando?" or a manager's PIN. Outside a panel (`active` false) calls go out as they are.
 */
export const operatorBridge: {
  active: boolean;
  /**
   * The provider that set the bridge, so an unmounting one never wipes a newer one's.
   */
  owner?: object;
  locked: boolean;
  token?: string;
  require?: () => Promise<void>;
  clear?: () => void;
  approve?: (permission: string) => Promise<string>;
  refreshLock?: () => Promise<void>;
} = { active: false, locked: false };

const UNGATED = /^\/panel\/staff\/(lock|unlock|approvals|owner-unlock)$/;

/**
 * The permission a 403 `approval_required` is about, from the route that answered it.
 */
const approvalPermission = (path: string) => {
  if (/^\/panel\/orders\/[^/?]+$/.test(path)) return 'orders_cancel';
  if (/^\/panel\/pos\/sales\/[^/]+\/cancel$/.test(path)) return 'pos_cancel';
  if (path === '/panel/cash/movements') return 'cash_move';
  if (/^\/panel\/couriers\/[^/]+\/settlements$/.test(path)) return 'courier_settle';
  if (/^\/panel\/cash\/sessions\/[^/]+\/close$/.test(path)) return 'cash_close';
  if (path.startsWith('/panel/pos/')) return 'pos_discount_over_limit';
};

/**
 * `fetch` against the Atendy API with the Clerk session token. The API uses snake_case on the wire. In a locked
 * panel it sends the operator (`x-operator`): a write without one first asks who is using, and a 403
 * `operator_required` / `approval_required` is asked and retried once.
 */
export const useApi = () => {
  const { getToken } = useAuth();

  return useCallback(
    async <T>(
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
      options: { skipCache?: boolean } = {}
    ): Promise<T> => {
      const send = async (approval?: string) => {
        const token = await getToken(options.skipCache ? { skipCache: true } : undefined);

        return fetch(`${API_URL}${path}`, {
          method,
          headers: {
            ...(token && { authorization: `Bearer ${token}` }),
            ...(operatorBridge.token && { 'x-operator': operatorBridge.token }),
            ...(approval && { 'x-approval': approval }),
            ...(body !== undefined && { 'content-type': 'application/json' })
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      };

      const gated = operatorBridge.active && path.startsWith('/panel/') && !UNGATED.test(path);

      if (gated && operatorBridge.locked && !operatorBridge.token && method !== 'GET') {
        await operatorBridge.require?.();
      }

      let response = await send();

      if (!response.ok && gated && response.status === 403) {
        const error = await readError(response);

        if (error.field === 'operator_required') {
          // This tab thought the store unlocked: the lock state is stale (a PIN employee created elsewhere).
          if (!operatorBridge.locked) {
            await operatorBridge.refreshLock?.();
          }

          operatorBridge.clear?.();
          await operatorBridge.require?.();
          response = await send();
        } else if (error.field === 'approval_required' && approvalPermission(path)) {
          response = await send(await operatorBridge.approve?.(approvalPermission(path)!));
        } else {
          throw error;
        }
      }

      if (!response.ok) {
        throw await readError(response);
      }

      return (await response.json()) as T;
    },
    [getToken]
  );
};

/**
 * `fetch` against a public route (no session token).
 */
export const getPublic = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`);

  if (!response.ok) {
    throw await readError(response);
  }

  return (await response.json()) as T;
};

/**
 * `POST` to a public route (no session token): the menu checkout.
 */
export const postPublic = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await readError(response);
  }

  return (await response.json()) as T;
};
