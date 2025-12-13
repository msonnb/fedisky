/** @type {import('jest').Config} */
module.exports = {
  displayName: 'API',
  transform: { '^.+\\.ts$': '@swc/jest' },
  transformIgnorePatterns: [
    `/node_modules/.pnpm/(?!(get-port|lande|toygrad|structured-field-values|@fedify|@logtape|url-template|urlpattern-polyfill|uri-template-router|es-toolkit|json-canon|byte-encodings|multicodec|@multiformats|@phensley|jsonld|@js-temporal|@cfworker|rdf-canonize|canonicalize)@)`,
  ],
  testTimeout: 60000,
  setupFiles: ['<rootDir>/../../jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^(\\.\\.?\\/.+)\\.js$': ['$1.ts', '$1.js'],
    '^#util$':
      '<rootDir>/../../node_modules/.pnpm/@logtape+logtape@1.1.2/node_modules/@logtape/logtape/dist/util.node.cjs',
  },
}
