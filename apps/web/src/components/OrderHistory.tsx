import type { OrderView } from '../state/dashboard';
import { shortId } from './format';

/** "Historial de pedidos": the dishes delivered this workday, the latest first. */
export function OrderHistory(props: { orders: OrderView[] }) {
  return (
    <details className="card">
      <summary>
        <h2>Order history</h2>
        <span className="muted">{props.orders.length} delivered this workday</span>
      </summary>
      {props.orders.length === 0 ? (
        <p className="muted">No dish delivered yet in this workday.</p>
      ) : (
        <ol className="history">
          {props.orders.map((order) => (
            <li key={order.orderId}>
              <code>{shortId(order.orderId)}</code> {order.recipeName ?? 'Dish'}
              {order.deliveredAt && (
                <span className="muted"> · {new Date(order.deliveredAt).toLocaleTimeString()}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
