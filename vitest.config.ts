import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60000,
    setupFiles: ['./tests/_setup.ts'],
    alias: {
      // Handle .js extension imports pointing to .ts files
      '^(\\.\\.?\\/.+)\\.js$': '$1.ts',
    },
  },
})
