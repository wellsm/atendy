const API_URL = 'https://api.clerk.com/v1';

const REQUEST_TIMEOUT_MS = 10_000;

const PAGE_SIZE = 100;

/**
 * How long a user's org list is reused (demo phones poll every few seconds).
 */
const MEMBERSHIP_CACHE_MS = 60_000;

export class ClerkRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

type ClerkUser = {
  id: string;
  primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string }[];
};

export type ClerkUserWithOrgs = {
  id: string;
  email: string;
  orgIds: string[];
};

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const data = (await response.json().catch(() => ({}))) as T & { errors?: { message?: string }[] };

  if (!response.ok) {
    const message = data.errors?.[0]?.message;

    throw new ClerkRequestError(
      `Clerk request failed (${response.status})${message ? `: ${message}` : ''}`,
      response.status
    );
  }

  return data;
};

const primaryEmail = (user: ClerkUser) => {
  const emails = user.email_addresses ?? [];

  return (emails.find(({ id }) => id === user.primary_email_address_id) ?? emails[0])?.email_address ?? '';
};

const cache = new Map<string, { orgIds: string[]; at: number }>();

/**
 * Clerk Backend API (`CLERK_SECRET_KEY`): orgs, users and memberships for the admin and the demo phones.
 */
export namespace ClerkBackend {
  export const createOrg = async (name: string) =>
    (await request<{ id: string }>('POST', '/organizations', { name })).id;

  export const deleteOrg = async (orgId: string) => {
    await request('DELETE', `/organizations/${orgId}`);
  };

  /**
   * No password: the instance signs in by email code (`+clerk_test` addresses take `424242`).
   */
  export const createUser = async (email: string) =>
    (await request<{ id: string }>('POST', '/users', { email_address: [email], skip_password_requirement: true })).id;

  export const getUser = async (userId: string) => {
    const user = await request<ClerkUser>('GET', `/users/${userId}`);

    return { id: user.id, email: primaryEmail(user) };
  };

  export const deleteUser = async (userId: string) => {
    cache.delete(userId);
    await request('DELETE', `/users/${userId}`);
  };

  /**
   * shortcut: only the first 100 memberships of a user, enough for demo logins; paginate if a user gets more.
   */
  const fetchUserOrgIds = async (userId: string) => {
    const { data } = await request<{ data: { organization: { id: string } }[] }>(
      'GET',
      `/users/${userId}/organization_memberships?limit=${PAGE_SIZE}`
    );

    return data.map(({ organization }) => organization.id);
  };

  /**
   * shortcut: per-Lambda 60 s cache of memberships, so a removed member keeps access up to 60 s; drop the cache if that
   * matters.
   */
  export const userOrgIds = async (userId: string) => {
    const cached = cache.get(userId);

    if (cached && Date.now() - cached.at < MEMBERSHIP_CACHE_MS) {
      return cached.orgIds;
    }

    const orgIds = await fetchUserOrgIds(userId);

    cache.set(userId, { orgIds, at: Date.now() });

    return orgIds;
  };

  export const clearCache = () => cache.clear();

  /**
   * Makes the user a member (`org:admin`) of exactly these orgs.
   */
  export const setUserOrgs = async (userId: string, orgIds: string[]) => {
    const current = await fetchUserOrgIds(userId);

    for (const orgId of orgIds.filter((id) => !current.includes(id))) {
      await request('POST', `/organizations/${orgId}/memberships`, { user_id: userId, role: 'org:admin' });
    }

    for (const orgId of current.filter((id) => !orgIds.includes(id))) {
      await request('DELETE', `/organizations/${orgId}/memberships/${userId}`);
    }

    cache.delete(userId);
  };

  /**
   * shortcut: one memberships request per user, fine for a few demo logins; use an instance-wide listing if it grows.
   */
  export const listUsers = async (): Promise<ClerkUserWithOrgs[]> => {
    const users: ClerkUser[] = [];

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await request<ClerkUser[]>('GET', `/users?limit=${PAGE_SIZE}&offset=${offset}`);

      users.push(...page);

      if (page.length < PAGE_SIZE) {
        break;
      }
    }

    return Promise.all(
      users.map(async (user) => ({ id: user.id, email: primaryEmail(user), orgIds: await fetchUserOrgIds(user.id) }))
    );
  };
}
