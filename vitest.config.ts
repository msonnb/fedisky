import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60000,
    include: ['src/**/tests/**/*.test.ts', 'e2e-tests/**/*.e2e.test.ts'],
    alias: {
      // Handle .js extension imports pointing to .ts files
      '^(\\.\\.?\\/.+)\\.js$': '$1.ts',
    },
  },
})
