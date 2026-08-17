import Link from 'next/link';
import { PostCard } from '@/components/PostCard';
import { getActor } from '@/lib/session';
import { getTimeline, listAdminGroups, listMyGroups } from '@/server/queries';

export const dynamic = 'force-dynamic';

/** 統合タイムライン（S-03） */
export default async function TimelinePage() {
  const actor = await getActor();
  if (!actor) {
    return (
      <>
        <header className="header">
          <h1>RoveringNow</h1>
        </header>
        <div className="empty">
          <p>上のバーから利用者を選ぶと、その人として画面を確認できます。</p>
        </div>
      </>
    );
  }

  const [{ items }, myGroups, adminGroups] = await Promise.all([
    getTimeline(actor.userId),
    listMyGroups(actor.userId),
    listAdminGroups(actor.userId),
  ]);

  return (
    <>
      <header className="header">
        <h1>RoveringNow</h1>
        {adminGroups.length > 0 ? (
          <Link href="/posts/new" className="btn btn-primary btn-sm spacer">
            連絡を書く
          </Link>
        ) : null}
      </header>

      <div className="content">
        {items.length === 0 ? (
          // 空状態は「未所属」と「連絡なし」で分ける（決定 T-51）
          myGroups.length === 0 ? (
            <div className="empty">
              <p>まだどのグループにも参加していません。</p>
              <Link href="/groups" className="btn btn-primary">
                グループを探す
              </Link>
            </div>
          ) : (
            <div className="empty">
              <p>新しい連絡はまだありません。</p>
            </div>
          )
        ) : (
          items.map((item) => <PostCard key={item.postId} item={item} />)
        )}
      </div>
    </>
  );
}
