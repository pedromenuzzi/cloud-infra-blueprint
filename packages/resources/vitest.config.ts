import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['blueprint:source', 'import', 'module', 'node', 'default'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
