'use server';

/**
 * 動作確認用の操作
 *
 * AUTH_MODE=dev のときだけ有効。認証基盤との接続が済むまでの代替であり、
 * 認証ではない。
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEV_USER_COOKIE, isDevAuthMode } from '@/lib/dev-auth';

/** Cookie の保持期間。動作確認用なので1週間で十分 */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function assertDevMode(): void {
  if (!isDevAuthMode()) {
    throw new Error('この操作は動作確認モードでのみ利用できます');
  }
}

/**
 * 操作者を切り替える。
 *
 * 誰として画面を見るかが変わる操作のため、再検証ではなくリダイレクトで
 * 実際に画面を移す。クライアント側での再描画に依存しないため、
 * JavaScript が動かない状態でも機能する。
 */
export async function switchDevUser(formData: FormData): Promise<void> {
  assertDevMode();

  const userId = String(formData.get('userId') ?? '').trim();
  if (userId === '') return;

  const store = await cookies();
  store.set(DEV_USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  // 切り替え後の利用者が今の画面を見られるとは限らないため、必ずホームへ戻す
  redirect('/');
}

export async function signOutDevUser(): Promise<void> {
  assertDevMode();

  const store = await cookies();
  store.delete(DEV_USER_COOKIE);
  redirect('/');
}
