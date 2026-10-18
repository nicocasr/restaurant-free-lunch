/**
 * Shared Jest configuration for unit tests. Every workspace extends it from its own
 * jest.config.cjs, so <rootDir> always points to that workspace.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Workspaces import each other's source directly, so tests never depend on a prior build.
  moduleNameMapper: {
    '^@alegra-lunch/(.*)$': '<rootDir>/../../packages/$1/src',
  },
  // Always measured, so CI fails when coverage drops below the PLANNING §6 target.
  collectCoverage: true,
  coverageReporters: ['text-summary', 'html'],
  // The target covers the domain and the use cases; adapters and entrypoints are covered by
  // the integration tests against LocalStack instead.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/infrastructure/**',
    '!<rootDir>/src/entrypoints/**',
    // Barrel files only re-export modules.
    '!<rootDir>/src/index.ts',
  ],
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
  clearMocks: true,
};
