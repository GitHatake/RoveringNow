/**
 * データベース接続
 *
 * 2 つの動作モードを持つ。
 *
 * - `DATABASE_URL` がある場合 … PostgreSQL へ接続する（本番・Supabase）
 * - ない場合 … PGlite（WebAssembly 版 PostgreSQL）をローカルのファイルに置いて動かす
 *
 * 後者は外部サービスに接続せずにアプリ全体を動かすためのもので、動作確認に用いる。
 * どちらも同一のマイグレーションを適用するため、スキーマは完全に一致する。
 */
// クライアント側のモジュールグラフに混入するとビルドが失敗するようにする。
// 実際、クライアントから参照される Server Action 経由でここが巻き込まれ、
// PGlite がバンドルされて WebAssembly の読み込みが壊れる事故が起きた。
import 'server-only';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = PgDatabase<any, typeof schema, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type DbDriver = 'postgres' | 'pglite';

export function currentDriver(): DbDriver {
  return process.env.DATABASE_URL ? 'postgres' : 'pglite';
}

/** マイグレーションを 1 文ずつ適用する。適用済みでも安全に再実行できる */
export async function applyMigrations(exec: (sql: string) => Promise<unknown>): Promise<number> {
  const dir = join(process.cwd(), 'drizzle');
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let applied = 0;
  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    for (const statement of content.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await exec(trimmed);
      applied += 1;
    }
  }
  return applied;
}

/**
 * 開発サーバの再読み込みでインスタンスが増えないよう、グローバルに1つだけ持つ。
 */
const globalForDb = globalThis as unknown as { __roveringNowDb?: Promise<Db> };

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ drizzle }, postgres] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ]);
    const client = postgres.default(url);
    return drizzle(client, { schema }) as unknown as Db;
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ]);

  // ファイルに置くことで、サーバを再起動しても入力した内容が残る
  const dataDir = process.env.PGLITE_DATA_DIR ?? join(process.cwd(), '.data', 'pglite');
  // PGlite は保存先を再帰的には作らないため、親ディレクトリを用意しておく
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;

  // ローカルモードでは起動時にスキーマを整える。
  // `create table` は既存だと失敗するため、初回のみ実行する
  const existing = await client.query<{ count: string }>(
    `select count(*)::text as count from information_schema.tables
      where table_schema = 'public' and table_name = 'users'`,
  );
  if (Number(existing.rows[0]?.count ?? '0') === 0) {
    await applyMigrations((sql) => client.exec(sql));
  }

  return drizzle(client, { schema }) as unknown as Db;
}

/** データベースを取得する。初回呼び出しで接続し、以後は同じものを返す */
export function getDb(): Promise<Db> {
  globalForDb.__roveringNowDb ??= createDb().catch((error: unknown) => {
    // 失敗したままキャッシュすると、原因を直しても再接続できなくなる
    delete globalForDb.__roveringNowDb;
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    throw new Error(`データベースに接続できませんでした（${currentDriver()}）:\n${detail}`);
  });
  return globalForDb.__roveringNowDb;
}

export { schema };
