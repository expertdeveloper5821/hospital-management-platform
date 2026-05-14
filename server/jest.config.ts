import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Runs before each test suite worker — sets env vars before any module is loaded
  setupFiles: ['<rootDir>/tests/setup.ts'],
  // Global dotenv-safe mock — prevents .env file requirement in all tests
  moduleNameMapper: {
    '^dotenv-safe$': '<rootDir>/tests/__mocks__/dotenv-safe.js',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: { branches: 70, functions: 80, lines: 80, statements: 80 },
  },
  verbose: true,
  // Increase timeout for integration tests that spin up mongodb-memory-server
  testTimeout: 30000,
};

export default config;
