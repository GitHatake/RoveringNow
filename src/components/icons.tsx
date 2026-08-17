/**
 * ナビゲーション用のアイコン
 *
 * 絵文字は使わない。端末ごとに描画が変わるうえ、多色のため配色から浮き、
 * 「色は語らない、余白が語る」という原則（デザインシステム 第1.2節）を崩す。
 * すべて `currentColor` の線画とし、文字色に追随させる。
 */
type IconProps = { size?: number };

function Svg({ size = 22, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </Svg>
  );
}

/** コレクション：集まったものが重なっている様子 */
export function CollectionIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="13" height="16" rx="2" />
      <path d="M19 7v13a1 1 0 0 1-1 1H7" />
      <path d="M7 9h5M7 13h5" />
    </Svg>
  );
}

/** スキャン：QRの読み取り枠 */
export function ScanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M7.5 12h9" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 15Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </Svg>
  );
}
