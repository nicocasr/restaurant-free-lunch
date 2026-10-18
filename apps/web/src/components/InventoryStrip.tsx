import type { Inventory } from '../api';

/** "Inventario de la bodega": a compact strip, so the focus stays on the orders. */
export function InventoryStrip(props: { inventory: Inventory | undefined }) {
  return (
    <section className="card">
      <h2>Warehouse inventory</h2>
      {!props.inventory ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="inventory">
          {props.inventory.ingredients.map((line) => (
            <li key={line.ingredient} className={line.stock === 0 ? 'empty' : undefined}>
              <span className="ingredient">{line.ingredient}</span>
              <span className="stock">{line.stock}</span>
              {line.inFlight > 0 && (
                <span className="muted small">+{line.inFlight} on its way</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
