/**
 * 認証バッジ（デザインシステム 第6.2節）
 *
 * 色以外の手がかり（チェックの形）を必ず持たせる。
 * 未認証のときは何も表示しない。「未認証」というラベルは出さない（決定 T-32）。
 */
export function CertifiedBadge({ certified }: { certified: boolean }) {
  if (!certified) return null;
  return (
    <span className="badge-certified" role="img" aria-label="認証済みの公式組織">
      ✓
    </span>
  );
}
