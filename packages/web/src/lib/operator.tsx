import type { ReactNode } from 'react';
import type { Sheet } from './panel-search';
import type { StaffRole } from './queries';

import { useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ApiError, operatorBridge } from './api';
import { useStaffLock } from './queries';
import { Loading } from '../components/loading';
import { ApprovalPrompt } from '../components/staff/approval-prompt';
import { Denied, LockScreen } from '../components/staff/lock-screen';

export type Operator = { id: string | null; name: string; role: StaffRole };

export type Screen = 'conversations' | 'board' | 'pos' | Sheet;

/**
 * Screens each role may open while the panel is locked (spec `docs/specs/staff.md`, Goal 3); a manager opens all.
 */
const ROLE_SCREENS: Record<StaffRole, Screen[] | 'all'> = {
  manager: 'all',
  cashier: ['conversations', 'board', 'pos', 'menu', 'stock'],
  kitchen: ['board', 'menu'],
  courier: []
};

const canOpen = (role: StaffRole, screen: Screen) => {
  const allowed = ROLE_SCREENS[role];

  return allowed === 'all' || allowed.includes(screen);
};

/**
 * The API permissions (`src/staff/permissions.ts`) whose controls a screen hides from roles without them.
 */
export type Permission = 'menu_edit' | 'stock_move' | 'stock_manage';

const ROLE_PERMISSIONS: Record<StaffRole, Permission[] | 'all'> = {
  manager: 'all',
  cashier: ['stock_move'],
  kitchen: [],
  courier: []
};

const canDo = (role: StaffRole, permission: Permission) => {
  const allowed = ROLE_PERMISSIONS[role];

  return allowed === 'all' || allowed.includes(permission);
};

const memory = new Map<string, string>();

// sessionStorage can throw (private window, blocked data): the memory copy keeps the tab working.
const readStored = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? memory.get(key);
  } catch {
    return memory.get(key);
  }
};

const writeStored = (key: string, value: string | undefined) => {
  if (value === undefined) {
    memory.delete(key);
  } else {
    memory.set(key, value);
  }

  try {
    if (value === undefined) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // memory fallback only
  }
};

type Session = { token: string; operator: Operator };

const parseSession = (raw: string | undefined | null): Session | undefined => {
  try {
    const value = raw ? (JSON.parse(raw) as Session) : undefined;

    return value?.token && value.operator?.name ? value : undefined;
  } catch {
    return undefined;
  }
};

type OperatorValue = {
  locked: boolean;
  operator?: Operator;
  /**
   * Resolves once someone is the operator (at once when the panel is not locked); rejects when the screen is dismissed.
   */
  requireOperator: () => Promise<void>;
  lock: () => void;
  /**
   * Used by the lock screen after a right PIN (or the owner's reverification).
   */
  signIn: (token: string, operator: Operator) => void;
  /**
   * Whether the operator may open the screen; true while unlocked or with nobody picked (the lock screen asks).
   */
  can: (screen: Screen) => boolean;
  /**
   * Whether the operator's role has the permission, so a screen shows its controls; true like `can`.
   */
  allows: (permission: Permission) => boolean;
};

const OperatorContext = createContext<OperatorValue>({
  locked: false,
  requireOperator: () => Promise.resolve(),
  lock: () => undefined,
  signIn: () => undefined,
  can: () => true,
  allows: () => true
});

export const useOperator = () => useContext(OperatorContext);

const IDLE_CHECK_MS = 5_000;

/**
 * "Quem está usando?" for the store panel (spec `docs/specs/staff.md`, Goal 2): keeps the operator token of this tab
 * (`sessionStorage`), locks again after the store's idle minutes, and lends the token to `useApi` (`operatorBridge`).
 * Locked and nobody picked: only the orders board shows; every other screen, and any write, asks first.
 */
export function OperatorProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const lockQuery = useStaffLock();
  const { pathname } = useLocation();
  const search = useSearch({ strict: false });
  const key = `atendy:operator:${slug}`;
  const [session, setSession] = useState(() => parseSession(readStored(key)));
  const [asking, setAsking] = useState(false);
  const [approval, setApproval] = useState<{
    permission: string;
    resolve: (token: string) => void;
    reject: (error: unknown) => void;
  }>();
  const waiters = useRef<{ resolve: () => void; reject: (error: unknown) => void }[]>([]);
  const lastActive = useRef(Date.now());
  const owner = useRef({});
  const justSignedIn = useRef(false);
  const pendingApproval = useRef<{ permission: string; promise: Promise<string> }>(undefined);
  const navigate = useNavigate();

  const locked = lockQuery.data?.locked ?? false;
  const operator = locked ? session?.operator : undefined;
  const state = useRef({ locked, hasOperator: !!operator });

  state.current = { locked, hasOperator: !!operator };

  const clear = useCallback(() => {
    // The bridge is read by the next API call, before any effect would run.
    operatorBridge.token = undefined;
    writeStored(key, undefined);
    setSession(undefined);
  }, [key]);

  const signIn = useCallback(
    (token: string, next: Operator) => {
      writeStored(key, JSON.stringify({ token, operator: next } satisfies Session));
      lastActive.current = Date.now();
      justSignedIn.current = true;
      // Set now, not in the layout effect: the call that waited for this sign-in sends right after the waiters resolve.
      operatorBridge.token = token;
      setSession({ token, operator: next });
      setAsking(false);

      for (const waiter of waiters.current.splice(0)) {
        waiter.resolve();
      }
    },
    [key]
  );

  const refetchLock = lockQuery.refetch;

  // Another device may have locked the store (its first PIN employee): learn it before asking who is using.
  const refreshLock = useCallback(async () => {
    const { data } = await refetchLock();

    // `requireOperator` reads this before the next render does.
    state.current.locked = data?.locked ?? state.current.locked;
  }, [refetchLock]);

  const requireOperator = useCallback(
    () =>
      !state.current.locked || state.current.hasOperator
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            waiters.current.push({ resolve, reject });
            setAsking(true);
          }),
    []
  );

  const dismiss = useCallback(() => {
    setAsking(false);

    for (const waiter of waiters.current.splice(0)) {
      waiter.reject(new ApiError(403, undefined, 'operator_required'));
    }
  }, []);

  const approve = useCallback((permission: string) => {
    const pending = pendingApproval.current;

    // A second call for the same permission shares the open prompt; another one waits for it to settle.
    if (pending?.permission === permission) {
      return pending.promise;
    }

    const ask = () => new Promise<string>((resolve, reject) => setApproval({ permission, resolve, reject }));

    const run = async () => {
      try {
        if (pending) {
          await pending.promise.catch(() => undefined);
        }

        return await ask();
      } finally {
        if (pendingApproval.current?.promise === promise) {
          pendingApproval.current = undefined;
        }
      }
    };
    const promise: Promise<string> = run();

    pendingApproval.current = { permission, promise };

    return promise;
  }, []);

  useLayoutEffect(() => {
    operatorBridge.owner = owner.current;
    operatorBridge.active = true;
    operatorBridge.locked = locked;
    operatorBridge.token = locked ? session?.token : undefined;
    operatorBridge.require = requireOperator;
    operatorBridge.clear = clear;
    operatorBridge.approve = approve;
    operatorBridge.refreshLock = refreshLock;
  }, [locked, session, requireOperator, clear, approve, refreshLock]);

  useEffect(
    () => () => {
      if (operatorBridge.owner === owner.current) {
        operatorBridge.active = false;
        operatorBridge.token = undefined;
      }
    },
    []
  );

  const idleMinutes = lockQuery.data?.idle_minutes;

  useEffect(() => {
    if (!operator || !idleMinutes) {
      return;
    }

    const touch = () => {
      lastActive.current = Date.now();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart'] as const;

    for (const name of events) {
      window.addEventListener(name, touch, { passive: true });
    }

    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > idleMinutes * 60_000) {
        clear();
      }
    }, IDLE_CHECK_MS);

    return () => {
      for (const name of events) {
        window.removeEventListener(name, touch);
      }

      clearInterval(timer);
    };
  }, [operator, idleMinutes, clear]);

  const screen: Screen = pathname.endsWith('/pos')
    ? 'pos'
    : (search.sheet ?? (search.view === 'orders' ? 'board' : 'conversations'));

  // Right after unlocking, a role that cannot open this screen lands on the board instead of "Sem permissão".
  useEffect(() => {
    if (!operator || !justSignedIn.current) {
      return;
    }

    justSignedIn.current = false;

    if (!canOpen(operator.role, screen)) {
      void navigate({ to: '/panel/$slug', params: { slug }, search: { view: 'orders' }, replace: true });
    }
  }, [operator, screen, slug, navigate]);

  const can = useCallback(
    (target: Screen) => !locked || !operator || canOpen(operator.role, target),
    [locked, operator]
  );

  const allows = useCallback(
    (permission: Permission) => !locked || !operator || canDo(operator.role, permission),
    [locked, operator]
  );

  const value = useMemo<OperatorValue>(
    () => ({ locked, operator, requireOperator, lock: clear, signIn, can, allows }),
    [locked, operator, requireOperator, clear, signIn, can, allows]
  );

  let content = children;

  if (lockQuery.isPending) {
    content = <Loading />;
  } else if (locked && !operator) {
    // The board stays readable (and live) on a screen nobody touches.
    content = screen === 'board' ? children : <LockScreen />;
  } else if (locked && operator && !canOpen(operator.role, screen)) {
    content = <Denied />;
  }

  return (
    <OperatorContext.Provider value={value}>
      {content}
      {asking && locked && !operator && screen === 'board' && <LockScreen onCancel={dismiss} />}
      {approval && (
        <ApprovalPrompt
          permission={approval.permission}
          onApproved={(token) => {
            approval.resolve(token);
            setApproval(undefined);
          }}
          onCancel={() => {
            approval.reject(new ApiError(403, undefined, 'approval_required'));
            setApproval(undefined);
          }}
        />
      )}
    </OperatorContext.Provider>
  );
}
