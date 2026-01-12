/** @type {import('jest').Config} */
module.exports = {
  displayName: 'ActivityPub Sidecar',
  transform: { '^.+\\.(t|j)s$': '@swc/jest' },
  testTimeout: 60000,
  setupFiles: ['<rootDir>/tests/_setup.ts'],
}
