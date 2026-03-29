import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/__tests__/**/*.test.ts',
      'src/orchestrator/**/*.test.ts',
      'src/bridge/**/*.test.ts',
    ],
    environment: 'node',
  },
});
