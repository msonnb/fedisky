/** @type {import('jest').Config} */
module.exports = {
  projects: ['<rootDir>/packages/*/jest.config.js'],
  moduleNameMapper: {
    '^#util$':
      '<rootDir>/../../node_modules/.pnpm/@logtape+logtape@1.1.2/node_modules/@logtape/logtape/dist/util.node.cjs',
  },
}
