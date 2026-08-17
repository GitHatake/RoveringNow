'use client';

import { useTransition } from 'react';
import { setReaction } from '@/server/actions/posts';
import type { ReactionKind } from '@/db/schema';

/**
 * リアクション（デザインシステム 第6.4節）
 *
 * 件数が0のときは数字を出さず、ラベルのみ表示する。
 */
export function ReactionBar({
  postId,
  ackCount,
  joiningCount,
  mine,
}: {
  postId: string;
  ackCount: number;
  joiningCount: number;
  mine: ReactionKind[];
}) {
  const [pending, startTransition] = useTransition();

  const toggle = (kind: ReactionKind) => {
    startTransition(async () => {
      await setReaction(postId, kind);
    });
  };

  const button = (kind: ReactionKind, label: string, count: number) => (
    <button
      type="button"
      className="reaction"
      aria-pressed={mine.includes(kind)}
      disabled={pending}
      onClick={() => toggle(kind)}
    >
      <span>{label}</span>
      {count > 0 ? <span className="tabular">{count}</span> : null}
    </button>
  );

  return (
    <div className="reactions">
      {button('ack', '了解', ackCount)}
      {button('joining', '参加したい', joiningCount)}
    </div>
  );
}
