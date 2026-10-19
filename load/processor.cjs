const { randomUUID } = require('node:crypto');

/** Every batch is a new click: a fresh Idempotency-Key, as the dashboard sends. */
function setIdempotencyKey(request, _context, _events, next) {
  request.headers = { ...request.headers, 'idempotency-key': randomUUID() };
  next();
}

module.exports = { setIdempotencyKey };
