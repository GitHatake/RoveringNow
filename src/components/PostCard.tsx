import Link from 'next/link';
import { CertifiedBadge } from './CertifiedBadge';
import { ReactionBar } from './ReactionBar';
import { formatDateTime, formatEvent, initials } from '@/lib/format';
import type { TimelineItem } from '@/server/queries';

/**
 * 連絡カード（デザインシステム 第4.3節）
 *
 * グループの頭文字を丸で示す。一覧を目で追うときの手がかりになり、
 * どのグループからの連絡かが文字を読む前に分かる（決定 T-81）。
 */
export function PostCard({ item, detail = false }: { item: TimelineItem; detail?: boolean }) {
  const shownNames = item.joiningNames.slice(0, 4);
  const rest = item.joiningCount - shownNames.length;

  return (
    <article className="post">
      <div className="post-head">
        <span className="monogram" aria-hidden="true">
          {initials(item.groupName)}
        </span>
        <div>
          <Link href={`/groups/${item.groupId}`} className="post-group">
            {item.groupName}
            <CertifiedBadge certified={item.isCertified} />
          </Link>
          <div className="post-meta">
            {formatDateTime(item.createdAt)}
            {item.editedAt ? '・編集済み' : ''}
          </div>
        </div>
      </div>

      <p className={detail ? 'post-body' : 'post-body clamped'}>{item.body}</p>

      {!detail ? (
        <Link href={`/posts/${item.postId}`} className="post-link">
          続きとコメントを見る
        </Link>
      ) : null}

      {item.eventAt ? (
        <div className="event-chip">
          <span className="when">{formatEvent(item.eventAt)}</span>
          <span className="note">
            カレンダーに追加すると、通知が届かない端末でも予定を確認できます。
          </span>
        </div>
      ) : null}

      {/* 0人のときは何も表示しない。最初の1人になることをためらわせないため */}
      {item.joiningCount > 0 ? (
        <div className="joining">
          <span className="avatars">
            {shownNames.map((name, index) => (
              <span key={`${name}-${index}`} className="avatar" aria-hidden="true">
                {initials(name)}
              </span>
            ))}
          </span>
          <span>
            {shownNames.join('・')}
            {rest > 0 ? ` ＋${rest}人` : ''}が参加
          </span>
        </div>
      ) : null}

      <ReactionBar
        postId={item.postId}
        ackCount={item.ackCount}
        joiningCount={item.joiningCount}
        mine={item.myReactions}
      />
    </article>
  );
}
