/**
 * セッションと操作者の取得
 *
 * 認証基盤（Supabase Auth）への接続は工程2-1の残作業であり、ここでは
 * **動作確認用の代替経路**を用意する。
 *
 * `AUTH_MODE=dev` のときだけ、Cookie に入れたユーザーIDをそのまま操作者として扱う。
 * これは認証ではない。誰でも任意の利用者になりすませるため、この経路が有効なときは
 * 画面上に警告を常時表示する（DevBanner）。
 *
 * アプリ内のユーザー識別子は自前の `users` テーブルで持つため（決定 T-06）、
 * 認証基盤を差し込む際に変更が必要なのはこのファイルだけで済む。
 */
import 'server-only';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { DEV_USER_COOKIE, isDevAuthMode } from '@/lib/dev-auth';
import type { Actor } from '@/domain/authorization';

export { DEV_USER_COOKIE, isDevAuthMode };

/**
 * 現在の操作者を返す。未ログインなら null。
 */
export async function getActor(): Promise<Actor | null> {
  if (!isDevAuthMode()) {
    // 認証基盤との接続は未実装。実装時はここでセッションを解決する
    return null;
  }

  const store = await cookies();
  const userId = store.get(DEV_USER_COOKIE)?.value;
  if (!userId) return null;

  const db = await getDb();
  const rows = await db
    .select({
      id: schema.users.id,
      status: schema.users.status,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    status: user.status,
    // 動作確認では、表示名に「運営」を含む利用者をシステム管理者として扱う。
    // 実装時は users に権限列を設けるか、認証基盤のロールを参照する
    isSystemAdmin: (user.displayName ?? '').includes('運営'),
  };
}

/** 操作者が必要な場面で用いる。未ログインなら例外を投げる */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (actor === null) {
    throw new Error('UNAUTHENTICATED');
  }
  return actor;
}
