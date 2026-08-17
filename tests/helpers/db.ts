/**
 * テスト用データベース
 *
 * PGlite（WebAssembly 版 PostgreSQL）を用い、実際の PostgreSQL に対して
 * 制約と再帰クエリを検証する。外部サービスに依存せず、生成済みのマイグレーションを
 * そのまま適用するため、本番と同じスキーマで検証できる。
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
  const client = new PGlite();
  await client.waitReady;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error('マイグレーションが見つかりません。npm run db:generate を実行してください');
  }

  for (const file of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // drizzle-kit が出力する文の区切り
    for (const statement of content.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        await client.exec(trimmed);
      }
    }
  }

  return { client, db: drizzle(client) };
}

/** 制約違反を期待する箇所で、違反の種類まで確認するためのヘルパー */
export async function expectViolation(
  run: () => Promise<unknown>,
): Promise<{ message: string; constraint: string | undefined }> {
  try {
    await run();
  } catch (error) {
    const err = error as { message?: string; constraint_name?: string; constraint?: string };
    return {
      message: err.message ?? String(error),
      constraint: err.constraint_name ?? err.constraint,
    };
  }
  throw new Error('制約違反が起きるはずでしたが、成功しました');
}
