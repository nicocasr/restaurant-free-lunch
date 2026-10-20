import { useState, type SyntheticEvent } from 'react';

import { api, ApiError } from '../api';

interface Exchange {
  question: string;
  answer: string;
  failed: boolean;
}

/** Questions a manager asks during the event, one click away. */
const SUGGESTIONS = [
  'Why are dishes waiting?',
  'What did we buy the most?',
  'How many dishes did we deliver of each recipe?',
];

/**
 * The operations assistant (PLANNING §5): the manager asks in plain words and Gemini answers
 * from the live data of the workday. It only reads; it never changes anything.
 */
export function AssistantPanel() {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  const ask = async (text: string) => {
    const asked = text.trim();
    if (!asked || asking) return;
    setAsking(true);
    try {
      const { answer } = await api.ask(asked);
      setExchanges((previous) => [{ question: asked, answer, failed: false }, ...previous]);
      setQuestion('');
    } catch (error) {
      const answer =
        error instanceof ApiError ? error.message : 'The assistant did not answer. Try again.';
      setExchanges((previous) => [{ question: asked, answer, failed: true }, ...previous]);
    } finally {
      setAsking(false);
    }
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <aside className="assistant" aria-label="Operations assistant">
      <h2>✨ Operations assistant</h2>
      <p className="muted">
        Ask in plain words about this workday: why dishes are waiting, what was bought, how many
        dishes went out.
      </p>

      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="chip"
            disabled={asking}
            onClick={() => void ask(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form className="ask" onSubmit={submit}>
        <label htmlFor="question" className="visually-hidden">
          Your question
        </label>
        <textarea
          id="question"
          rows={2}
          maxLength={500}
          placeholder="Ask a question…"
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter asks; Shift+Enter starts a new line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(question);
            }
          }}
        />
        <button type="submit" disabled={asking || !question.trim()}>
          {asking ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      <ol className="exchanges" aria-live="polite">
        {exchanges.map((exchange, index) => (
          <li key={exchanges.length - index} className="exchange">
            {/* The answer on top, its question right below it, the newest exchange first. */}
            <div className={exchange.failed ? 'answer error' : 'answer'}>
              <span className="speaker" aria-hidden="true">
                ✨ Assistant
              </span>
              <span className="visually-hidden">The assistant answered: </span>
              <p>{exchange.answer}</p>
            </div>
            <p className="question">
              <span className="visually-hidden">You asked: </span>
              {exchange.question}
            </p>
          </li>
        ))}
      </ol>
      <p className="hint">Answers come from the live data and may take a few seconds.</p>
    </aside>
  );
}
