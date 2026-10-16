/**
 * Shared Jest configuration. Every workspace extends it from its own jest.config.cjs,
 * so <rootDir> always points to that workspace.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Workspaces import each other's source directly, so tests never depend on a prior build.
  moduleNameMapper: {
    '^@alegra-lunch/(.*)$': '<rootDir>/../../packages/$1/src',
  },
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
  clearMocks: true,
};
