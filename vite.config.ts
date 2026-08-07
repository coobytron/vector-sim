import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
