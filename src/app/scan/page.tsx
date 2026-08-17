import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * QRスキャナ（S-16）
 *
 * カメラを用いた読み取りは工程2-4以降で実装する（スタンプ機能と同時に作る）。
 * ここでは、この画面が担う役割を示すにとどめる。
 */
export default async function ScanPage() {
  const actor = await getActor();
  if (!actor) redirect('/');

  return (
    <>
      <header className="header">
        <Link href="/" className="btn btn-ghost btn-sm" aria-label="戻る">
          ←
        </Link>
        <h1>スキャン</h1>
      </header>

      <div className="content">
        <div className="empty">
          <p>QRの読み取りは、スタンプ機能とあわせて実装します（工程2-4）。</p>
        </div>
        <div className="card">
          <strong>この画面が担うこと</strong>
          <ul style={{ margin: 'var(--sp-3) 0 0', paddingLeft: '1.2em', color: 'var(--c-text-muted)' }}>
            <li>スタンプQR … 活動への参加を記録する</li>
            <li>カードQR … プロフィールカードを交換する</li>
            <li>参加QR … グループに参加する</li>
          </ul>
          <p className="hint">
            3種類を1つのスキャナで自動判別します。利用者は用途の違いを意識しません。
          </p>
        </div>
      </div>
    </>
  );
}
