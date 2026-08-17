'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * グローバルナビゲーション（デザインシステム 第6.5節）
 *
 * 中央のスキャンは選択状態にかかわらず常に強調する。QRはスタンプ獲得・
 * カード交換・グループ参加の共通入口であり、現場で数秒で到達する必要があるため。
 */
const TABS = [
  { href: '/', icon: '🏠', label: 'ホーム' },
  { href: '/collection', icon: '📔', label: 'コレクション' },
  { href: '/scan', icon: '⌗', label: 'スキャン', scan: true },
  { href: '/notifications', icon: '🔔', label: '通知' },
  { href: '/mypage', icon: '👤', label: 'マイページ' },
] as const;

export function TabBar({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="メインナビゲーション">
      {TABS.map((tab) => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={'scan' in tab && tab.scan ? 'scan' : undefined}
          >
            <span className="icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.href === '/notifications' && unreadCount > 0 ? (
              <span className="badge-dot" aria-hidden="true" />
            ) : null}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
