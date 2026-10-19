import { useState, type SyntheticEvent } from 'react';

import { api, ApiError } from '../api';

/** The button of the manager (R1). It cannot send twice: high demand is expected (§3.3). */
export function OrderForm() {
  const [quantity, setQuantity] = useState(10);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  // A new quantity means a new order: the notice of the previous one would only confuse.
  const choose = (value: number) => {
    setQuantity(value);
    setMessage(undefined);
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setSending(true);
    setMessage(undefined);
    try {
      // One key per click: if the request is retried, the same dishes are not placed twice.
      const { orderIds } = await api.placeOrders(quantity, crypto.randomUUID());
      setMessage({ text: `${String(orderIds.length)} dishes sent to the kitchen`, error: false });
    } catch (error) {
      setMessage({
        text: error instanceof ApiError ? error.message : 'The kitchen did not answer. Try again.',
        error: true,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card order-form">
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="quantity">Dishes to prepare</label>
        <div className="row">
          <input
            id="quantity"
            type="number"
            min={1}
            max={1000}
            value={quantity}
            onChange={(event) => {
              choose(Number(event.target.value));
            }}
          />
          {[10, 50, 100].map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip"
              onClick={() => {
                choose(preset);
              }}
            >
              {preset}
            </button>
          ))}
          <button type="submit" disabled={sending || quantity < 1}>
            {sending ? 'Sending…' : 'Order dishes'}
          </button>
        </div>
      </form>
      {message && (
        <p className={message.error ? 'hint error' : 'hint success'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
