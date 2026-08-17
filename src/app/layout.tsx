import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RoveringNow',
  description: '連絡が届き、活動が記録され、仲間が集まる — ローバースカウトのためのデジタル手帳',
  applicationName: 'RoveringNow',
  // iOS ではホーム画面に追加されない限りプッシュ通知が届かないため、
  // Web アプリとしてホーム画面に追加できることを明示する（基本設計書 第14.2節 制約1）
  appleWebApp: { capable: true, title: 'RoveringNow', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 端末の文字サイズ設定に追随させるため、拡大を禁じない
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1917' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
