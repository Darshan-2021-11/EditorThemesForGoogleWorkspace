import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __WD_DEV__: 'false' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
