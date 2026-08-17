/**
 * 動作確認モードの定数
 *
 * データベースに触れないものだけを置く。
 * クライアント側から参照される Server Action がここを読むため、
 * このモジュールが重い依存を持つと、それらがクライアント境界に巻き込まれる。
 */
export const DEV_USER_COOKIE = 'rn_dev_user';

/** 認証を伴わない動作確認モードかどうか */
export function isDevAuthMode(): boolean {
  return process.env.AUTH_MODE === 'dev';
}
