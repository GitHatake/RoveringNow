import Link from 'next/link';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { GROUP_KIND_LABEL, GROUP_STATUS_LABEL, initials } from '@/lib/format';
import { getActor } from '@/lib/session';
import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { listMyGroups } from '@/server/queries';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** マイページ（S-20） */
export default async function MyPage() {
  const actor = await getActor();
  if (!actor) redirect('/');

  const db = await getDb();
  const [card] = await db
    .select()
    .from(schema.profileCards)
    .where(eq(schema.profileCards.userId, actor.userId))
    .limit(1);
  const groups = await listMyGroups(actor.userId);

  return (
    <>
      <header className="header">
        <h1>マイページ</h1>
      </header>

      <div className="content">
        <section className="card">
          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
            <span className="avatar" style={{ width: 44, height: 44, marginRight: 0, fontSize: 16 }}>
              {initials(card?.displayName)}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-subtitle)' }}>
                {card?.displayName ?? '（カード未作成）'}
              </div>
              {card?.bio ? <div className="row-meta">{card.bio}</div> : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
            <Link href="/scan" className="btn btn-secondary btn-sm">
              カードを見せる
            </Link>
          </div>
        </section>

        <section style={{ marginTop: 'var(--sp-8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>所属グループ</h2>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
              <Link href="/groups" className="btn btn-ghost btn-sm">
                探す
              </Link>
              <Link href="/groups/new" className="btn btn-secondary btn-sm">
                作る
              </Link>
            </span>
          </div>

          {groups.length === 0 ? (
            <div className="empty">
              <p>まだどのグループにも参加していません。</p>
              <Link href="/groups" className="btn btn-primary">
                グループを探す
              </Link>
            </div>
          ) : (
            <div className="list" style={{ marginTop: 'var(--sp-4)' }}>
              {groups.map((group) => (
                <Link key={group.id} href={`/groups/${group.id}`} className="row">
                  <div className="row-title">
                    {group.name}
                    <CertifiedBadge certified={group.isCertified} />
                  </div>
                  <div className="row-meta">
                    {GROUP_KIND_LABEL[group.kind]}
                    {group.role === 'admin' ? '・管理者' : ''}
                    {group.status !== 'active' ? `・${GROUP_STATUS_LABEL[group.status]}` : ''}
                    {group.isMuted ? '・ミュート中' : ''}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
