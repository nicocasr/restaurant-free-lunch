import type { DomainEvent } from '@alegra-lunch/contracts';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { api, type Inventory, type Recipe } from './api';
import { AssistantPanel } from './components/AssistantPanel';
import { Header } from './components/Header';
import { InventoryStrip } from './components/InventoryStrip';
import { OrderForm } from './components/OrderForm';
import { OrderHistory } from './components/OrderHistory';
import { OrdersInPreparation } from './components/OrdersInPreparation';
import { Purchases } from './components/Purchases';
import { Recipes } from './components/Recipes';
import { Stats } from './components/Stats';
import { config } from './config';
import { useLiveEvents } from './live';
import {
  dashboardReducer,
  delivered,
  emptyDashboard,
  orderHistory,
  inPreparation,
} from './state/dashboard';

export function App() {
  const [state, dispatch] = useReducer(dashboardReducer, emptyDashboard);
  const [inventory, setInventory] = useState<Inventory>();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<string>();

  /** Loads everything from the services; runs on start and on every reconnection. */
  const load = useCallback(async () => {
    try {
      const { workdayId, orders } = await api.orders();
      const purchases = workdayId ? (await api.purchases(workdayId)).purchases : [];
      dispatch({ type: 'loaded', workdayId, orders, purchases });
      setInventory(await api.inventory());
      setError(undefined);
    } catch {
      setError('Some services did not answer. Retrying when the connection comes back.');
    }
  }, []);

  const onEvents = useCallback((events: DomainEvent[]) => {
    dispatch({ type: 'events', events });
  }, []);
  const live = useLiveEvents(config.realtimeUrl, onEvents, () => void load());

  useEffect(() => {
    void api.recipes().then(setRecipes, () => undefined);
  }, []);

  // The events do not carry the whole stock: read it again, at most once per batch (§2).
  // A purchase reaches the dashboard and the warehouse at the same time, so that read may come
  // before the warehouse applies it: one more read a second after the last change settles it.
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!state.inventoryOutdated) return;
    dispatch({ type: 'inventoryReloaded' });
    const reload = () => void api.inventory().then(setInventory, () => undefined);
    reload();
    clearTimeout(settle.current);
    settle.current = setTimeout(reload, 1_000);
  }, [state.inventoryOutdated]);

  const preparing = inPreparation(state);
  const history = delivered(state);

  return (
    <div className="layout">
      <main className="board">
        <Header
          workdayId={state.workdayId}
          live={live}
          ordersInProgress={preparing.length}
          onWorkdayStarted={() => void load()}
        />
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        {/* A new workday starts a clean form: the notice of the last order belongs to the old one. */}
        <OrderForm key={state.workdayId} />
        <Stats preparing={preparing} delivered={history.length} />
        <OrdersInPreparation orders={preparing} />
        <InventoryStrip inventory={inventory} />
        <Purchases purchases={state.purchases} />
        <OrderHistory orders={orderHistory(state)} />
        <Recipes recipes={recipes} />
      </main>
      <AssistantPanel />
    </div>
  );
}
