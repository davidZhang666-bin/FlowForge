import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  projects: [
    { test: { name: 'unit', include: ['packages/**/*.test.ts'], environment: 'node' } },
    { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 15000, hookTimeout: 30000 } },
  ],
  fileParallelism: false,
  coverage: { provider: 'v8', include: ['packages/core/src/**'], thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 } },
} });
