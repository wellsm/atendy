import { useAuth } from '@clerk/react';
import { useCallback } from 'react';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    /**
     * Message of a 4xx error body (`{ message, context: { field } }`), when the API sent one.
     */
    public readonly detail?: string,
    public readonly field?: string
  ) {
    super(`API request failed (${status})`);
  }
}

const readError = async (response: Response) => {
  const body = (await response.json().catch(() => ({}))) as { message?: unknown; context?: { field?: unknown } };

  return new ApiError(
    response.status,
    typeof body.message === 'string' ? body.message : undefined,
    typeof body.context?.field === 'string' ? body.context.field : undefined
  );
};

const API_URL = import.meta.env.VITE_API_URL as string;

/**
 * `fetch` against the Atendy API with the Clerk session token. The API uses snake_case on the wire.
 */
export const useApi = () => {
  const { getToken } = useAuth();

  return useCallback(
    async <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> => {
      const token = await getToken();

      const response = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body !== undefined && { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });

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
