import { useState } from 'react';

import { api, ApiError } from '../api';
import type { LiveStatus } from '../live';
import { shortId } from './format';

const LIVE_LABELS: Record<LiveStatus, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline, reconnecting',
};

export function Header(props: {
  workdayId: string | undefined;
  live: LiveStatus;
  ordersInProgress: number;
  onWorkdayStarted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string>();
  const blocked = props.ordersInProgress > 0;

  const startWorkday = async () => {
    setStarting(true);
    setMessage(undefined);
    try {
      await api.startWorkday();
      props.onWorkdayStarted();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Could not start a new workday.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <header className="header">
      <div>
        <h1>🍽️ Free Lunch Day</h1>
        <p className="muted">
          Workday {props.workdayId ? <code>{shortId(props.workdayId)}</code> : '—'}
          <span className={`live live-${props.live}`}>● {LIVE_LABELS[props.live]}</span>
        </p>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="secondary"
          disabled={blocked || starting}
          onClick={() => void startWorkday()}
          title={
            blocked
              ? 'A new workday starts once every order is delivered'
              : 'Resets the warehouse to 5 units of each ingredient'
          }
        >
          {starting ? 'Starting…' : 'New workday'}
        </button>
        {blocked && (
          <p className="hint">
            {props.ordersInProgress} {props.ordersInProgress === 1 ? 'order' : 'orders'} still in
            progress
          </p>
        )}
        {message && (
          <p className="hint error" role="alert">
            {message}
          </p>
        )}
      </div>
    </header>
  );
}
