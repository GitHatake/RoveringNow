import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // 未使用変数は _ 始まりのみ許容する。握りつぶしを見逃さないため。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // App Router のみを用いるため、pages ディレクトリを前提とする規則は無効にする
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];

export default config;
