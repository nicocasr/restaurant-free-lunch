import { useNow } from '../live';
import type { OrderView } from '../state/dashboard';
import { elapsed, shortId, STATUS_LABELS } from './format';

/** "Órdenes en preparación": every order not delivered yet, oldest first. */
export function OrdersInPreparation(props: { orders: OrderView[] }) {
  const now = useNow();
  return (
    <section className="card">
      <h2>Orders in preparation</h2>
      {props.orders.length === 0 ? (
        <p className="muted">No orders in progress. Order some dishes above.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Dish</th>
                <th>Status</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {props.orders.map((order) => (
                <tr key={order.orderId}>
                  <td>
                    <code>{shortId(order.orderId)}</code>
                  </td>
                  <td>{order.recipeName ?? '…'}</td>
                  <td>
                    <span className={`status status-${order.status.toLowerCase()}`}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td>
                    {order.status === 'WAITING_INGREDIENTS' && order.missing ? (
                      <>
                        {order.missing.map(({ ingredient, quantity }) => (
                          <span key={ingredient} className="chip small">
                            {ingredient} ×{quantity}
                          </span>
                        ))}
                        {order.waitingSince && (
                          <span className="muted"> for {elapsed(order.waitingSince, now)}</span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
