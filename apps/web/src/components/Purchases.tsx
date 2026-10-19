import type { Purchase } from '../state/dashboard';

/**
 * "Historial de compras en la plaza": per ingredient, how many purchases were made and how
 * many units they brought, since the farmers market decides how much it sells each time.
 */
export function Purchases(props: { purchases: readonly Purchase[] }) {
  const totals = new Map<string, { units: number; purchases: number }>();
  for (const { ingredient, quantity } of props.purchases) {
    const total = totals.get(ingredient) ?? { units: 0, purchases: 0 };
    totals.set(ingredient, { units: total.units + quantity, purchases: total.purchases + 1 });
  }

  return (
    <section className="card">
      <h2>Farmers market purchases</h2>
      {props.purchases.length === 0 ? (
        <p className="muted">Nothing bought yet: the warehouse had everything.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th className="number">Purchases</th>
                <th className="number">Units bought</th>
              </tr>
            </thead>
            <tbody>
              {[...totals]
                .sort(([, a], [, b]) => b.units - a.units)
                .map(([ingredient, total]) => (
                  <tr key={ingredient}>
                    <td className="capitalize">{ingredient}</td>
                    <td className="number">{total.purchases}</td>
                    <td className="number">{total.units}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
