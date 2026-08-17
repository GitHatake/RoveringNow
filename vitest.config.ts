import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // pglite の起動を含むため、DB を使うテストには余裕を持たせる
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * server-only は、react-server 条件のときだけ空実装に解決され、
       * それ以外では読み込み時に例外を投げる印付けパッケージ。
       * テストはサーバ側のコードを実行するため、空実装へ明示的に向ける。
       * （node_modules は Vite の resolve.conditions を経由しないため別名で解決する）
       */
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
});
