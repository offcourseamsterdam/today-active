import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Emulator tests need `firebase emulators:exec` running — see `npm run test:emulator`.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/emulator/**'],
  },
})
