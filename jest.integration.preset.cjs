/**
 * Shared Jest configuration for integration tests: adapters against LocalStack, which must be
 * running (docker compose up -d --wait).
 */
const unit = require('./jest.preset.cjs');

module.exports = {
  ...unit,
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  setupFiles: ['<rootDir>/../../jest.integration.setup.cjs'],
  // Tests share the LocalStack tables, so they run one at a time and get more time per test.
  maxWorkers: 1,
  testTimeout: 30_000,
  collectCoverage: false,
  coverageThreshold: undefined,
};
