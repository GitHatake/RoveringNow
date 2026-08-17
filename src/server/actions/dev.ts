'use server';

/**
 * 動作確認用の操作
 *
 * AUTH_MODE=dev のときだけ有効。認証基盤との接続が済むまでの代替であり、
 * 認証ではない。
 */
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { DEV_USER_COOKIE, isDevAuthMode } from '@/lib/dev-auth';

export async function switchDevUser(userId: string): Promise<void> {
  if (!isDevAuthMode()) {
    throw new Error('この操作は動作確認モードでのみ利用できます');
  }
  const store = await cookies();
  store.set(DEV_USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  revalidatePath('/', 'layout');
}

export async function signOutDevUser(): Promise<void> {
  if (!isDevAuthMode()) {
    throw new Error('この操作は動作確認モードでのみ利用できます');
  }
  const store = await cookies();
  store.delete(DEV_USER_COOKIE);
  revalidatePath('/', 'layout');
}
