const path = require('path');

module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^@op-engineering/op-sqlite$':
      '<rootDir>/node_modules/@op-engineering/op-sqlite/node/dist/index.js',
    '^react-native($|/.*)': `${path.dirname(require.resolve('react-native'))}/$1`,
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // The leading `.*` also matches packages resolved through node_modules/.pnpm.
  transformIgnorePatterns: [
    'node_modules/(?!.*(?:@react-native|react-native|@react-navigation|@op-engineering|op-sqlite))',
  ],
};
