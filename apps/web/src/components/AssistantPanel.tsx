/** The operations assistant (PLANNING §5) arrives in phase 6; its place is kept on screen. */
export function AssistantPanel() {
  return (
    <aside className="assistant" aria-label="Operations assistant">
      <h2>✨ Operations assistant</h2>
      <p className="muted">
        Ask in plain words: why orders are waiting, what was bought the most, how this workday
        compares to the last one.
      </p>
      <p className="hint">Coming in the next step.</p>
    </aside>
  );
}
