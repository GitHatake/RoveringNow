import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { GroupActions } from './GroupActions';
import { GROUP_KIND_LABEL, GROUP_STATUS_LABEL, JOIN_POLICY_LABEL, formatDate } from '@/lib/format';
import { getActor } from '@/lib/session';
import { getGroupDetail } from '@/server/queries';

export const dynamic = 'force-dynamic';

/** グループ詳細（S-08）と管理（S-10・S-11） */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) notFound();

  const group = await getGroupDetail(id, actor.userId);
  if (!group) notFound();

  const isAdmin = group.isOwner || (group.myStatus === 'active' && group.myRole === 'admin');

  return (
    <>
      <header className="header">
        <Link href="/groups" className="btn btn-ghost btn-sm" aria-label="戻る">
          ←
        </Link>
        <h1>グループ</h1>
      </header>

      <div className="content">
        <h2 style={{ margin: 0, fontSize: 'var(--fs-title)' }}>
          {group.name}
          <CertifiedBadge certified={group.isCertified} />
        </h2>
        <p className="row-meta">
          {GROUP_KIND_LABEL[group.kind]}・{JOIN_POLICY_LABEL[group.joinPolicy]}・
          <span className="tabular">{group.memberCount}</span>人
          {group.parentName ? `・${group.parentName} の配下` : ''}
        </p>

        {group.status !== 'active' ? (
          <p className="notice" style={{ marginTop: 'var(--sp-3)' }}>
            このグループは「{GROUP_STATUS_LABEL[group.status]}」です。新しい連絡は投稿できません。
          </p>
        ) : null}

        {group.description ? (
          <p style={{ marginTop: 'var(--sp-4)', whiteSpace: 'pre-wrap' }}>{group.description}</p>
        ) : null}

        {group.expiresAt ? (
          <p className="hint">期限：{formatDate(group.expiresAt)}</p>
        ) : null}

        <div style={{ marginTop: 'var(--sp-6)' }}>
          <GroupActions
            groupId={group.id}
            joinPolicy={group.joinPolicy}
            myStatus={group.myStatus}
            isOwner={group.isOwner}
            isMuted={group.isMuted}
          />
        </div>

        {isAdmin && group.pendingRequests.length > 0 ? (
          <section style={{ marginTop: 'var(--sp-8)' }}>
            <h3 style={{ fontSize: 'var(--fs-subtitle)', margin: '0 0 var(--sp-3)' }}>
              参加申請<span className="tabular"> {group.pendingRequests.length}</span>
            </h3>
            <div className="list">
              {group.pendingRequests.map((request) => (
                <div key={request.userId} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                    <span style={{ fontWeight: 700 }}>{request.displayName}</span>
                    <span className="spacer" style={{ marginLeft: 'auto' }}>
                      <GroupActions
                        groupId={group.id}
                        joinPolicy={group.joinPolicy}
                        myStatus={group.myStatus}
                        isOwner={group.isOwner}
                        isMuted={group.isMuted}
                        approveUserId={request.userId}
                      />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {isAdmin && group.descendants.length > 0 ? (
          <section style={{ marginTop: 'var(--sp-8)' }}>
            <h3 style={{ fontSize: 'var(--fs-subtitle)', margin: '0 0 var(--sp-3)' }}>
              配下のグループ
            </h3>
            <p className="hint" style={{ marginTop: 0 }}>
              承認は直上の親子関係についてのみ行われるため、孫以降もここで確認できます。
            </p>
            <div className="list">
              {group.descendants.map((child) => (
                <Link key={child.groupId} href={`/groups/${child.groupId}`} className="row">
                  <div className="row-title" style={{ opacity: child.severed ? 0.5 : 1 }}>
                    {'　'.repeat(child.depth - 1)}
                    {child.depth > 1 ? '└ ' : ''}
                    {child.name}
                  </div>
                  <div className="row-meta">
                    <span className="tabular">{child.memberCount}</span>人
                    {child.severed ? '・切断中' : ''}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
