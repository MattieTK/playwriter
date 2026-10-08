import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000, // 60 seconds for Chrome startup
    hookTimeout: 30000,
    exclude: ['dist', 'dist/**/*', 'node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],

    env: {
      PLAYWRITER_NODE_ENV: 'development',
      PLAYWRITER_TELEMETRY: '0',
      // keep test runs out of the user's ~/.playwriter/activity.jsonl
      PLAYWRITER_ACTIVITY_LOG_PATH: 'tmp/test-activity.jsonl',
    },
  },
})
