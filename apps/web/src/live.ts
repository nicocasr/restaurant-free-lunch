import type { DomainEvent } from '@alegra-lunch/contracts';
import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Keeps a WebSocket open to the realtime service and hands over each batch of events.
 * It reconnects on its own; onConnected runs on every (re)connection, so the dashboard reloads
 * whatever it may have missed while it was offline.
 */
export function useLiveEvents(
  url: string,
  onEvents: (events: DomainEvent[]) => void,
  onConnected: () => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handlers = useRef({ onEvents, onConnected });
  handlers.current = { onEvents, onConnected };

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      setStatus('connecting');
      socket = new WebSocket(url);
      socket.onopen = () => {
        attempt = 0;
        setStatus('live');
        handlers.current.onConnected();
      };
      socket.onmessage = (message) => {
        const batch = JSON.parse(String(message.data)) as { events?: DomainEvent[] };
        handlers.current.onEvents(batch.events ?? []);
      };
      socket.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        // 1 s, 2 s, 4 s… up to 10 s, like the retries of the backend.
        retry = setTimeout(connect, Math.min(10_000, 1_000 * 2 ** attempt++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [url]);

  return status;
}

/** Re-renders every second, for the "waiting for 12 s" counters. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
