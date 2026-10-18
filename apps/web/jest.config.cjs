const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  // The logic of the dashboard lives in src/state; components are checked in the browser.
  collectCoverageFrom: ['<rootDir>/src/state/**/*.ts'],
};
