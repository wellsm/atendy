import type { ReactNode } from 'react';

import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';

const REALTIME_URL = import.meta.env.VITE_REALTIME_URL as string | undefined;

const HEARTBEAT_MS = 60_000;
// API Gateway drops a connection idle for 10 min; nothing for 150 s means it is gone without a close event.
const WATCHDOG_MS = 150_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Polling interval of the panel queries while the socket is connected: only a fallback for lost events.
 */
export const REALTIME_FALLBACK_MS = 60_000;

type RefreshEvent = {
  type: 'refresh';
  triggers: ('orders' | 'conversations')[];
  conversation_id?: string;
};

const ConnectedContext = createContext(false);

/**
 * True while the store panel's socket is open; outside the panel (or without `VITE_REALTIME_URL`) always false.
 */
export const useRealtimeConnected = () => useContext(ConnectedContext);

/**
 * Keeps one WebSocket per panel tab (spec `docs/specs/panel-realtime.md`): the API says what changed and the
 * matching queries refetch. A fresh Clerk token on every attempt; full-jitter backoff between attempts.
 */
export function RealtimeProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!REALTIME_URL) {
      return;
    }

    let stopped = false;
    let socket: WebSocket | undefined;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const refetch = (keys: unknown[][]) => {
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const armWatchdog = () => {
      clearTimeout(watchdog);
      // A dead connection can take a minute more to report its close: give it up now and reconnect.
      watchdog = setTimeout(() => {
        const dead = socket;

        socket = undefined;
        clearInterval(heartbeat);
        setConnected(false);
        dead?.close();
        scheduleRetry();
      }, WATCHDOG_MS);
    };

    const scheduleRetry = () => {
      if (stopped) {
        return;
      }

      const ceiling = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt);

      attempt += 1;
      retry = setTimeout(() => void connect(), Math.random() * ceiling);
    };

    const connect = async () => {
      let token: string | null;

      try {
        token = await getToken();
      } catch {
        token = null;
      }

      if (stopped) {
        return;
      }

      if (!token) {
        scheduleRetry();
        return;
      }

      const current = new WebSocket(
        `${REALTIME_URL}?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`
      );

      socket = current;

      current.onopen = () => {
        attempt = 0;
        setConnected(true);
        armWatchdog();
        heartbeat = setInterval(() => current.send(JSON.stringify({ type: 'alive' })), HEARTBEAT_MS);
        // Catch up on whatever happened while disconnected (or before the first connect).
        refetch([['orders'], ['conversations'], ['conversation'], ['draft']]);
      };

      current.onmessage = (message) => {
        armWatchdog();

        let event: RefreshEvent | { type: string };

        try {
          event = JSON.parse(String(message.data)) as RefreshEvent | { type: string };
        } catch {
          return;
        }

        if (event.type !== 'refresh') {
          return;
        }

        const { triggers, conversation_id: conversationId } = event as RefreshEvent;

        if (triggers.includes('orders')) {
          refetch([['orders']]);
        }

        if (triggers.includes('conversations')) {
          refetch([
            ['conversations'],
            ...(conversationId
              ? [
                  ['conversation', conversationId],
                  ['draft', conversationId]
                ]
              : [])
          ]);
        }
      };

      current.onclose = () => {
        // A socket given up by the watchdog closes late: its timers are gone and the new socket's must stay.
        if (socket === current) {
          clearInterval(heartbeat);
          clearTimeout(watchdog);
          socket = undefined;
          setConnected(false);
          scheduleRetry();
        }
      };
    };

    void connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      clearTimeout(watchdog);
      socket?.close();
      socket = undefined;
      setConnected(false);
    };
  }, [slug, getToken, queryClient]);

  return <ConnectedContext.Provider value={connected}>{children}</ConnectedContext.Provider>;
}
