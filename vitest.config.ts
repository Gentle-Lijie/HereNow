import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    env: { NODE_ENV: 'test', DB_NAME: 'herenow_test' },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
