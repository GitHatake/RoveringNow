import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PostForm } from './PostForm';
import { getActor } from '@/lib/session';
import { listAdminGroups } from '@/server/queries';

export const dynamic = 'force-dynamic';

/** 連絡作成（S-06） */
export default async function NewPostPage() {
  const actor = await getActor();
  if (!actor) redirect('/');

  const groups = await listAdminGroups(actor.userId);

  return (
    <>
      <header className="header">
        <Link href="/" className="btn btn-ghost btn-sm" aria-label="戻る">
          ←
        </Link>
        <h1>連絡を作成</h1>
      </header>

      <div className="content">
        {groups.length === 0 ? (
          <div className="empty">
            <p>連絡を投稿できるグループがありません。</p>
            <p className="hint">連絡を投稿できるのは、グループの管理者だけです。</p>
          </div>
        ) : (
          <PostForm groups={groups} />
        )}
      </div>
    </>
  );
}
