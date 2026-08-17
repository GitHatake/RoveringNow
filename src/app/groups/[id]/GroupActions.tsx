'use client';

import { useState, useTransition } from 'react';
import { approveJoinRequest, joinGroup, leaveGroup, toggleMute } from '@/server/actions/groups';
import { ERROR_MESSAGES } from '@/lib/result';
import type { JoinPolicy } from '@/db/schema';

type Props = {
  groupId: string;
  joinPolicy: JoinPolicy;
  myStatus: 'none' | 'invited' | 'requested' | 'active' | 'left';
  isOwner: boolean;
  isMuted: boolean;
  approveUserId?: string;
};

export function GroupActions(props: Props) {
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; code?: string; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message || ERROR_MESSAGES[result.code as keyof typeof ERROR_MESSAGES]);
      } else {
        setLeaving(false);
      }
    });
  };

  if (props.approveUserId) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={() => run(() => approveJoinRequest(props.groupId, props.approveUserId!))}
      >
        承認する
      </button>
    );
  }

  // 脱退の確認。取り消せるかどうかを明示する（デザインシステム 第6.9節）
  if (leaving) {
    return (
      <div className="card">
        <strong>このグループから脱退します</strong>
        <p style={{ color: 'var(--c-text-muted)', marginBottom: 'var(--sp-4)' }}>
          今後このグループの連絡は届きません。もう一度参加することはできます。
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setLeaving(false)}>
            取り消し
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending}
            onClick={() => run(() => leaveGroup(props.groupId))}
          >
            脱退する
          </button>
        </div>
        {error ? <p className="hint hint-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}>
      {props.myStatus === 'active' ? (
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pending}
            onClick={() => run(() => toggleMute(props.groupId))}
          >
            {props.isMuted ? 'ミュートを解除' : '通知をミュート'}
          </button>
          {props.isOwner ? (
            <span className="hint">
              オーナーは脱退できません。先に別の管理者へ移譲してください。
            </span>
          ) : (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setLeaving(true)}>
              脱退する
            </button>
          )}
        </>
      ) : props.myStatus === 'requested' ? (
        <span className="notice">参加を申請しました。承認をお待ちください。</span>
      ) : props.joinPolicy === 'invite' && props.myStatus !== 'invited' ? (
        <span className="hint">招待制のグループです。管理者からの招待が必要です。</span>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => run(() => joinGroup(props.groupId))}
        >
          {props.joinPolicy === 'request' ? '参加を申請する' : '参加する'}
        </button>
      )}
      {error ? <p className="hint hint-error">{error}</p> : null}
    </div>
  );
}
