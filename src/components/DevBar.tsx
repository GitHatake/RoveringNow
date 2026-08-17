'use client';

import { signOutDevUser, switchDevUser } from '@/server/actions/dev';

/**
 * 動作確認用のユーザー切替
 *
 * これは認証ではない。誰でも任意の利用者になりすませるため、
 * この経路が有効な間は常に警告を表示する。
 *
 * 通常のフォーム送信として実装している。切り替えはサーバ側でリダイレクトを伴い、
 * クライアント側の再描画に依存しない。JavaScript が無効でも動く。
 */
export function DevBar({
  users,
  currentUserId,
}: {
  users: Array<{ id: string; displayName: string | null }>;
  currentUserId: string | null;
}) {
  return (
    <div className="devbar">
      <strong>動作確認モード</strong>
      <span>認証は無効です。利用者を切り替えて挙動を確認できます。</span>

      <form action={switchDevUser} className="devbar-form">
        <label htmlFor="dev-user">利用者</label>
        <select
          id="dev-user"
          name="userId"
          defaultValue={currentUserId ?? ''}
          // 選ぶだけで切り替わるようにする。押し忘れを防ぐため
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="" disabled>
            選んでください
          </option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName ?? '(名前なし)'}
            </option>
          ))}
        </select>
        {/* JavaScript が動かない場合の経路。押しても同じ結果になる */}
        <button type="submit">切り替え</button>
      </form>

      {currentUserId ? (
        <form action={signOutDevUser}>
          <button type="submit">未ログインに戻す</button>
        </form>
      ) : null}
    </div>
  );
}
