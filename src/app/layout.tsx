import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DevBar } from '@/components/DevBar';
import { TabBar } from '@/components/TabBar';
import { getActor, isDevAuthMode } from '@/lib/session';
import { countUnreadNotifications, listAllUsers } from '@/server/queries';

export const metadata: Metadata = {
  title: 'RoveringNow',
  description: '連絡が届き、活動が記録され、仲間が集まる — ローバースカウトのためのデジタル手帳',
  applicationName: 'RoveringNow',
  // iOS ではホーム画面に追加されない限りプッシュ通知が届かない（基本設計書 第14.2節 制約1）
  appleWebApp: { capable: true, title: 'RoveringNow', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 端末の文字サイズ設定に追随させるため、拡大を禁じない
  maximumScale: 5,
  // テーマは白ベースに固定するため、端末設定で切り替えない（決定 T-79）
  themeColor: '#f7f9fa',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const devMode = isDevAuthMode();
  const actor = await getActor();
  const users = devMode ? await listAllUsers() : [];
  const unread = actor ? await countUnreadNotifications(actor.userId) : 0;

  return (
    <html lang="ja">
      <body>
        {devMode ? <DevBar users={users} currentUserId={actor?.userId ?? null} /> : null}
        <div className="app-shell">{children}</div>
        {actor ? <TabBar unreadCount={unread} /> : null}
      </body>
    </html>
  );
}
