type Fields = Record<string, unknown>;

export interface Logger {
  info: (message: string, fields?: Fields) => void;
  warn: (message: string, fields?: Fields) => void;
  error: (message: string, fields?: Fields) => void;
}

/** JSON.stringify drops the name, message and stack of an Error: they are copied here. */
function serializable(value: unknown): unknown {
  return value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : value;
}

/**
 * Structured logger: one JSON line per entry on the standard output, where Docker and
 * CloudWatch collect them. Fields such as correlationId make a whole order searchable.
 */
export function createLogger({
  service,
  write = (line) => process.stdout.write(line),
}: {
  service: string;
  write?: (line: string) => void;
}): Logger {
  const log =
    (level: string) =>
    (message: string, fields: Fields = {}) => {
      const entry: Fields = { level, service, message, time: new Date().toISOString() };
      for (const [name, value] of Object.entries(fields)) {
        entry[name] = serializable(value);
      }
      write(`${JSON.stringify(entry)}\n`);
    };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}
