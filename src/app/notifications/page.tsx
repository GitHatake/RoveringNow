import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import { getActor } from '@/lib/session';
import { listNotifications } from '@/server/queries';
import { markAllNotificationsRead } from '@/server/actions/notifications';

export const dynamic = 'force-dynamic';

const CHANNEL_LABEL: Record<string, string> = {
  N1: 'グループからの連絡',
  N2: 'コメント・リアクション',
  N3: 'スタンプ',
  N4: 'カード交換',
  N5: 'グループ参加',
  N6: 'グループ管理',
  N7: 'ROVERPORT',
  N8: '運営からのお知らせ',
};

/** 通知一覧（S-21）。チャンネルごとのタブには分けず、時系列を優先する */
export default async function NotificationsPage() {
  const actor = await getActor();
  if (!actor) redirect('/');

  const notifications = await listNotifications(actor.userId);
  const hasUnread = notifications.some((item) => item.readAt === null);

  return (
    <>
      <header className="header">
        <h1>通知</h1>
        {hasUnread ? (
          <form action={markAllNotificationsRead} className="spacer">
            <button type="submit" className="btn btn-ghost btn-sm">
              すべて既読にする
            </button>
          </form>
        ) : null}
      </header>

      <div className="content">
        {notifications.length === 0 ? (
          <div className="empty">
            <p>お知らせはまだありません。</p>
          </div>
        ) : (
          <div className="list">
            {notifications.map((item) => (
              <Link key={item.id} href={item.link} className="row">
                <div className="row-meta" style={{ marginTop: 0 }}>
                  {item.readAt === null ? '● ' : ''}
                  {CHANNEL_LABEL[item.channel] ?? item.channel}・{formatDateTime(item.createdAt)}
                </div>
                <div style={{ marginTop: 'var(--sp-1)' }}>{item.body}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
