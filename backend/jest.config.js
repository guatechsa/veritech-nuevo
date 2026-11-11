/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/cargar-env.js'],
  testTimeout: 30000,
  // Las pruebas con base de datos comparten el servidor; se corren en serie (--runInBand).
};
