'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BellIcon,
  CollectionIcon,
  HomeIcon,
  PersonIcon,
  ScanIcon,
} from '@/components/icons';

/**
 * グローバルナビゲーション（デザインシステム 第6.5節）
 *
 * 中央のスキャンは選択状態にかかわらず常に強調する。QRはスタンプ獲得・
 * カード交換・グループ参加の共通入口であり、現場で数秒で到達する必要があるため。
 */
const TABS = [
  { href: '/', label: 'ホーム', Icon: HomeIcon },
  { href: '/collection', label: 'コレクション', Icon: CollectionIcon },
  { href: '/scan', label: 'スキャン', Icon: ScanIcon, scan: true },
  { href: '/notifications', label: '通知', Icon: BellIcon },
  { href: '/mypage', label: 'マイページ', Icon: PersonIcon },
] as const;

export function TabBar({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="メインナビゲーション">
      {TABS.map((tab) => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        const isScan = 'scan' in tab && tab.scan;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={isScan ? 'scan' : undefined}
          >
            <span className="icon">
              <tab.Icon size={isScan ? 24 : 22} />
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
