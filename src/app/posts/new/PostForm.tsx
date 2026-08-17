'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { countAudience, createPost } from '@/server/actions/posts';
import { ERROR_MESSAGES } from '@/lib/result';
import type { PostScope } from '@/db/schema';

type GroupOption = { id: string; name: string; isCertified: boolean; hasChildren: boolean };

/**
 * 連絡の作成（決定 T-48・T-49）
 *
 * 配信範囲の選択肢に対象人数を常時表示する。「配下すべて」が何人なのかは
 * 投稿者に見えないため、38人のつもりが340人だったという事故を防げない。
 * 配下配信のときのみ確認を挟む。
 */
export function PostForm({ groups }: { groups: GroupOption[] }) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [scope, setScope] = useState<PostScope>('self');
  const [body, setBody] = useState('');
  const [eventAt, setEventAt] = useState('');
  /** どのグループについて数えた結果かを持ち、切り替え直後の古い値を表示しない */
  const [counts, setCounts] = useState<{
    groupId: string;
    self: number | null;
    descendants: number | null;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const group = groups.find((candidate) => candidate.id === groupId);
  const canBroadcast = group?.hasChildren ?? false;
  // 配下を持たないグループでは「配下すべて」を選べない。状態を書き戻さず描画時に解決する
  const effectiveScope: PostScope = canBroadcast ? scope : 'self';
  const currentCounts = counts?.groupId === groupId ? counts : null;

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;

    void (async () => {
      const selfResult = await countAudience(groupId, 'self');
      const allResult = canBroadcast ? await countAudience(groupId, 'descendants') : null;
      if (cancelled) return;
      setCounts({
        groupId,
        self: selfResult.ok ? selfResult.data.count : null,
        descendants: allResult?.ok ? allResult.data.count : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId, canBroadcast]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createPost({
        groupId,
        body,
        scope: effectiveScope,
        eventAt: eventAt ? new Date(eventAt).toISOString() : null,
      });
      if (result.ok) {
        router.push(`/posts/${result.data.postId}`);
      } else {
        setConfirming(false);
        setError(result.message || ERROR_MESSAGES[result.code]);
      }
    });
  };

  const targetCount =
    effectiveScope === 'self' ? (currentCounts?.self ?? null) : (currentCounts?.descendants ?? null);

  if (confirming) {
    return (
      <div className="card">
        <h2 style={{ margin: 0, fontSize: 'var(--fs-subtitle)' }}>
          {targetCount !== null ? `${targetCount}人に送信します` : '送信します'}
        </h2>
        <p style={{ color: 'var(--c-text-muted)' }}>
          送信後、本文は編集できますが、通知はやり直せません。
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            戻る
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
            送信する
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // 配下配信のときだけ確認を挟む。自グループのみにまで求めると手軽さを損なう
        if (effectiveScope === 'descendants') setConfirming(true);
        else submit();
      }}
    >
      <label className="field">
        <span className="label">送信元</span>
        <select
          className="select"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          {groups.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.isCertified ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="label">届く範囲</span>
        <label className="scope-option">
          <input
            type="radio"
            name="scope"
            checked={effectiveScope === 'self'}
            onChange={() => setScope('self')}
          />
          <span>このグループのみ</span>
          <span className="count">
            {currentCounts?.self == null ? '…' : `${currentCounts.self}人`}
          </span>
        </label>

        {canBroadcast ? (
          <label className="scope-option">
            <input
              type="radio"
              name="scope"
              checked={effectiveScope === 'descendants'}
              onChange={() => setScope('descendants')}
            />
            <span>配下すべて</span>
            <span className="count">
              {currentCounts?.descendants == null ? '…' : `${currentCounts.descendants}人`}
            </span>
          </label>
        ) : null}
      </div>

      <label className="field">
        <span className="label">本文</span>
        <textarea
          className="textarea"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
        />
        {body.length > 1800 ? (
          <span className="hint tabular">残り {2000 - body.length} 文字</span>
        ) : null}
      </label>

      <label className="field">
        <span className="label">日時（任意）</span>
        <input
          type="datetime-local"
          className="input"
          value={eventAt}
          onChange={(event) => setEventAt(event.target.value)}
        />
        <span className="hint">設定すると、受け取った人がカレンダーに追加できます。</span>
      </label>

      {error ? <p className="hint hint-error">{error}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={pending || body.trim() === ''}>
        送信
      </button>
    </form>
  );
}
