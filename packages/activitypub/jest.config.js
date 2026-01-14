/** @type {import('jest').Config} */
module.exports = {
  displayName: 'ActivityPub Sidecar',
  transform: { '^.+\\.(t|j)s$': '@swc/jest' },
  testTimeout: 60000,
  setupFiles: ['<rootDir>/tests/_setup.ts'],
  moduleNameMapper: {
    '^(\\.\\.?\\/.+)\\.js$': ['$1.ts', '$1.js'],
    // Handle @logtape/logtape's #util subpath import
    '^#util$':
      '<rootDir>/../../node_modules/.pnpm/@logtape+logtape@1.1.2/node_modules/@logtape/logtape/dist/util.node.cjs',
  },
  // Transform ESM-only packages in node_modules
  // Match: node_modules/.pnpm/<package>@version/node_modules/<package>/
  transformIgnorePatterns: [
    '/node_modules/\\.pnpm/(?!(structured-field-values|url-template|@logtape\\+logtape|@fedify\\+fedify|@fedify\\+testing|multibase|multicodec|uint8arrays|@noble|iso-datestring-validator|@cfworker\\+json-schema|asn1js|pvutils|pkijs|@js-temporal|@huggingface)[^/]*/)/',
  ],
}
