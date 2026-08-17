'use client';

import { useTransition } from 'react';
import { switchDevUser } from '@/server/actions/dev';

/**
 * 動作確認用のユーザー切替
 *
 * これは認証ではない。誰でも任意の利用者になりすませるため、
 * この経路が有効な間は常に警告を表示する。
 */
export function DevBar({
  users,
  currentUserId,
}: {
  users: Array<{ id: string; displayName: string | null }>;
  currentUserId: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="devbar">
      <strong>動作確認モード</strong>
      <span>認証は無効です。利用者を切り替えて挙動を確認できます。</span>
      <label className="spacer" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <span className="visually-hidden" style={{ alignSelf: 'center' }}>
          利用者
        </span>
        <select
          value={currentUserId ?? ''}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            startTransition(async () => {
              await switchDevUser(value);
            });
          }}
        >
          <option value="" disabled>
            利用者を選ぶ
          </option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName ?? '(名前なし)'}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
