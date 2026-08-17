import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDate, initials } from '@/lib/format';
import { getActor } from '@/lib/session';
import { getCollection } from '@/server/queries';

export const dynamic = 'force-dynamic';

type StampDesign = { shape?: string; color?: string; icon?: string };

/** コレクション（S-17 / S-18）。この領域だけ紙の地と箔押し風の縁を使う */
export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = 'stamps' } = await searchParams;
  const actor = await getActor();
  if (!actor) redirect('/');

  const { stamps, cards } = await getCollection(actor.userId);
  const showingStamps = tab !== 'cards';

  return (
    <>
      <header className="header">
        <h1>コレクション</h1>
      </header>

      <div className="content">
        <nav className="segmented" aria-label="表示の切り替え">
          <Link href="/collection?tab=stamps" aria-current={showingStamps ? 'page' : undefined}>
            スタンプ
          </Link>
          <Link href="/collection?tab=cards" aria-current={!showingStamps ? 'page' : undefined}>
            カード
          </Link>
        </nav>

        <div className="collection">
          {showingStamps ? (
            stamps.length === 0 ? (
              <div className="empty">
                <p>活動に参加すると、ここにスタンプが集まります。</p>
              </div>
            ) : (
              <div className="stamp-grid">
                {stamps.map((stamp) => {
                  const design = (stamp.design ?? {}) as StampDesign;
                  return (
                    <div key={stamp.id}>
                      <div
                        className={`stamp ${design.shape ?? 'circle'}`}
                        // 縁は箔の色で統一する。スタンプごとの色は地に淡く敷く（第7.2節）
                        style={
                          design.color
                            ? ({ '--stamp-color': design.color } as React.CSSProperties)
                            : undefined
                        }
                        role="img"
                        aria-label={`${stamp.name}（${formatDate(stamp.activityDate)}）`}
                      >
                        <span aria-hidden="true">{design.icon ?? '★'}</span>
                      </div>
                      <div className="stamp-caption">
                        {stamp.name}
                        <br />
                        {formatDate(stamp.activityDate)}
                      </div>
                    </div>
                  );
                })}
                {/* 未獲得の枠。「あと何個」とは数えない（決定 T-34） */}
                {Array.from({ length: (3 - (stamps.length % 3)) % 3 || 3 }).map((_, index) => (
                  <div key={`placeholder-${index}`}>
                    <div className="stamp-placeholder" />
                  </div>
                ))}
              </div>
            )
          ) : cards.length === 0 ? (
            <div className="empty">
              <p>QRを読み取ると、出会った人のカードが集まります。</p>
              <Link href="/scan" className="btn btn-primary">
                スキャンする
              </Link>
            </div>
          ) : (
            <div className="card-grid">
              {cards.map((card) => (
                <div key={card.userId} className="trading-card">
                  <div className="band" />
                  <div className="avatar" style={{ marginRight: 0, width: 32, height: 32 }}>
                    {initials(card.displayName)}
                  </div>
                  <div className="name" style={{ marginTop: 'var(--sp-2)' }}>
                    {card.displayName}
                  </div>
                  {/* 所属は「あれば示す」のみ。未所属を明示しない（決定38） */}
                  {card.affiliation ? <div className="affiliation">{card.affiliation}</div> : null}
                  {card.bio ? <div className="bio">{card.bio}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
