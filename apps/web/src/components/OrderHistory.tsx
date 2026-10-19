import type { PlacedOrder } from '../state/dashboard';

const MAX_RECIPES_SHOWN = 3;

/** "1:05" from a duration in milliseconds. */
function minutesAndSeconds(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "Historial de pedidos": one row per order the manager placed, the latest first. */
export function OrderHistory(props: { orders: PlacedOrder[] }) {
  return (
    <section className="card">
      <h2>Order history</h2>
      {props.orders.length === 0 ? (
        <p className="muted">No orders yet in this workday.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="number">#</th>
                <th>Placed</th>
                <th className="number">Dishes</th>
                <th>Progress</th>
                <th>Dishes served</th>
                <th className="number">Took</th>
              </tr>
            </thead>
            <tbody>
              {props.orders.map((order, index) => {
                const shown = order.served.slice(0, MAX_RECIPES_SHOWN);
                const more = order.served.length - shown.length;
                return (
                  <tr key={order.batchId ?? 'unknown'}>
                    <td className="number">{props.orders.length - index}</td>
                    <td>{order.placedAt ? new Date(order.placedAt).toLocaleTimeString() : '—'}</td>
                    <td className="number">{order.dishes}</td>
                    <td>
                      <div className="progress">
                        <progress value={order.delivered} max={order.dishes} />
                        <span className="muted small">
                          {order.delivered}/{order.dishes}
                        </span>
                      </div>
                    </td>
                    <td>
                      {shown.length === 0
                        ? '—'
                        : shown
                            .map(({ recipeName, count }) => `${recipeName} ${String(count)}`)
                            .join(' · ')}
                      {more > 0 && <span className="muted"> · +{more} more</span>}
                    </td>
                    <td className="number">
                      {order.tookMs !== undefined ? (
                        minutesAndSeconds(order.tookMs)
                      ) : order.delivered < order.dishes ? (
                        <span className="muted">in progress</span>
                      ) : (
                        // Delivered before the times were kept: there is nothing to measure.
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
