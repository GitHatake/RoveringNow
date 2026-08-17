import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PostCard } from '@/components/PostCard';
import { CommentForm } from './CommentForm';
import { formatDateTime } from '@/lib/format';
import { getActor } from '@/lib/session';
import { getPostDetail } from '@/server/queries';

export const dynamic = 'force-dynamic';

/** 連絡詳細（S-05） */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) notFound();

  // 配信対象でなければ存在しないものとして扱う（決定 T-43）
  const post = await getPostDetail(id, actor.userId);
  if (!post) notFound();

  return (
    <>
      <header className="header">
        <Link href="/" className="btn btn-ghost btn-sm" aria-label="戻る">
          ←
        </Link>
        <h1>連絡</h1>
      </header>

      <div className="content">
        <PostCard item={post} detail />

        <section style={{ marginTop: 'var(--sp-8)' }}>
          <h2 className="section-title">
            コメント<span className="tabular">{post.comments.length}</span>
          </h2>

          {post.comments.length === 0 ? (
            <p className="hint">まだコメントはありません。</p>
          ) : (
            <div className="list">
              {post.comments.map((comment) => (
                <div key={comment.id} className="card">
                  <div style={{ fontWeight: 700 }}>{comment.authorName ?? '退会したユーザー'}</div>
                  <div className="row-meta">{formatDateTime(comment.createdAt)}</div>
                  <p style={{ margin: 'var(--sp-2) 0 0', whiteSpace: 'pre-wrap' }}>{comment.body}</p>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 'var(--sp-4)' }}>
            <CommentForm postId={post.postId} />
          </div>
        </section>
      </div>
    </>
  );
}
