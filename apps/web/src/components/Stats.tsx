import type { OrderView } from '../state/dashboard';

export function Stats(props: { preparing: OrderView[]; delivered: number }) {
  const waiting = props.preparing.filter(({ status }) => status === 'WAITING_INGREDIENTS').length;
  const tiles = [
    { label: 'In preparation', value: props.preparing.length - waiting, warn: false },
    { label: 'Waiting for ingredients', value: waiting, warn: waiting > 0 },
    { label: 'Delivered', value: props.delivered, warn: false },
  ];
  return (
    <section className="stats" aria-label="Summary">
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.warn ? 'stat warn' : 'stat'}>
          <span className="stat-value">{tile.value}</span>
          <span className="muted">{tile.label}</span>
        </div>
      ))}
    </section>
  );
}
