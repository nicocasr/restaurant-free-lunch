import { createLogger } from '../../src/logging/logger';

describe('logger', () => {
  it('writes one JSON line per entry, with the service and any fields', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'warehouse', write: (line) => lines.push(line) });

    logger.info('order reserved', { orderId: 'order-1', correlationId: 'trace-1' });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'info',
      service: 'warehouse',
      message: 'order reserved',
      time: expect.any(String) as string,
      orderId: 'order-1',
      correlationId: 'trace-1',
    });
  });

  it('keeps the name, message and stack of an error, which JSON would drop', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'market', write: (line) => lines.push(line) });

    logger.error('purchase failed', { error: new RangeError('market answered -1') });
    logger.warn('slow market');

    const [error, warn] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(error).toMatchObject({
      level: 'error',
      error: {
        name: 'RangeError',
        message: 'market answered -1',
        stack: expect.any(String) as string,
      },
    });
    expect(warn).toMatchObject({ level: 'warn', message: 'slow market' });
  });

  it('writes to the standard output by default, where CloudWatch and Docker collect logs', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    createLogger({ service: 'kitchen' }).info('started');

    expect(write).toHaveBeenCalledWith(expect.stringContaining('"message":"started"'));
    write.mockRestore();
  });
});
