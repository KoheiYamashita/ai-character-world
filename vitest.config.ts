import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/lib/**/*.ts',
        'src/data/maps/grid.ts',
        'src/server/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**/*.ts',
        'src/app/**/*.ts',
        'src/app/**/*.tsx',
        'src/components/**/*.tsx',
        'src/hooks/**/*.ts',
        'src/stores/**/*.ts',
        'src/lib/pixiRenderers.ts',
        'src/lib/spritesheet.ts',
        'src/server/llm/**/*.ts',
        'src/server/simulation/dataLoader.ts',
        'src/server/persistence/SqliteStore.ts',
        // Complex integration components - require e2e testing
        'src/server/simulation/SimulationEngine.ts',
        'src/server/simulation/CharacterSimulator.ts',
        'src/server/behavior/**/*.ts',
        // Re-export modules
        'src/**/index.ts',
        'src/server/persistence/StateStore.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
