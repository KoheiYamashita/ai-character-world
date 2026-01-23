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
        'src/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**/*.ts',
        // Re-export modules
        'src/**/index.ts',
        // 純粋インターフェース（ランタイムコードなし）
        'src/server/behavior/BehaviorDecider.ts',
        'src/server/persistence/StateStore.ts',
        // ブラウザ/PixiJS依存（e2eテスト対象）
        'src/lib/pixiRenderers.ts',
        'src/lib/spritesheet.ts',
        'src/components/**',
        'src/hooks/**',
        'src/app/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
