import type { Purchase } from '../state/dashboard';

/** "Historial de compras en la plaza", folded by default to keep the focus on the orders. */
export function Purchases(props: { purchases: readonly Purchase[] }) {
  const totals = new Map<string, number>();
  for (const { ingredient, quantity } of props.purchases) {
    totals.set(ingredient, (totals.get(ingredient) ?? 0) + quantity);
  }
  const summary = [...totals]
    .map(([ingredient, units]) => `${ingredient} ${String(units)}`)
    .join(', ');

  return (
    <details className="card">
      <summary>
        <h2>Farmers market purchases</h2>
        <span className="muted">
          {props.purchases.length} purchases this workday{summary && ` · ${summary}`}
        </span>
      </summary>
      {props.purchases.length === 0 ? (
        <p className="muted">Nothing bought yet: the warehouse had everything.</p>
      ) : (
        <ol className="purchases">
          {[...props.purchases].reverse().map((purchase) => (
            <li key={purchase.purchaseId}>
              Bought <strong>{purchase.quantity}</strong> {purchase.ingredient}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
