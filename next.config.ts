import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * PGlite は WebAssembly と自身のファイル読み込みを持つため、バンドルすると
   * 内部のパス解決が壊れる（fs.readFile に URL が渡り ERR_INVALID_ARG_TYPE になる）。
   * サーバ側の外部パッケージとして、node_modules から直接読ませる。
   */
  serverExternalPackages: ['@electric-sql/pglite'],
  /**
   * AGENTS.md / CLAUDE.md の自動生成を止める。
   * この2つは Next.js の一般的な作法を書いたものだが、本プロジェクトでは
   * 設計書と CLAUDE.md に固有の規約を置いているため、上書きされると困る。
   */
  agentRules: false,
  /**
   * 開発時のインジケータを出さない。画面左下に重なり、タブバーの「ホーム」を
   * 隠してしまうため（動作確認の妨げになる）。
   */
  devIndicators: false,
};

export default nextConfig;
