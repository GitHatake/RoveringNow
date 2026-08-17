import Link from 'next/link';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { GROUP_KIND_LABEL, JOIN_POLICY_LABEL } from '@/lib/format';
import { getActor } from '@/lib/session';
import { searchGroups } from '@/server/queries';

export const dynamic = 'force-dynamic';

/** グループ検索（S-07）。認証バッジ付きを上位に表示する */
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const actor = await getActor();
  const groups = actor ? await searchGroups(q) : [];

  return (
    <>
      <header className="header">
        <Link href="/mypage" className="btn btn-ghost btn-sm" aria-label="戻る">
          ←
        </Link>
        <h1>グループを探す</h1>
        <Link href="/groups/new" className="btn btn-secondary btn-sm spacer">
          作る
        </Link>
      </header>

      <div className="content">
        <form className="field" method="get">
          <label className="label" htmlFor="q">
            グループ名で探す
          </label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="例：すみだ" />
        </form>

        {groups.length === 0 ? (
          <div className="empty">
            <p>見つかりませんでした。</p>
            <Link href="/groups/new" className="btn btn-primary">
              グループを作る
            </Link>
          </div>
        ) : (
          <div className="list">
            {groups.map((group) => (
              <Link key={group.id} href={`/groups/${group.id}`} className="row">
                <div className="row-title">
                  {group.name}
                  <CertifiedBadge certified={group.isCertified} />
                </div>
                <div className="row-meta">
                  {GROUP_KIND_LABEL[group.kind]}・{JOIN_POLICY_LABEL[group.joinPolicy]}・
                  <span className="tabular">{group.memberCount}</span>人
                  {group.parentName ? `・${group.parentName} の配下` : ''}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
