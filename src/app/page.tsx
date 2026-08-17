/**
 * 暫定のトップ画面。
 *
 * 画面の実装は工程2-2以降で行う（06_screen_spec.md）。
 * 現時点では、デザイントークンが適用されていることを確認するための最小構成にとどめる。
 */
export default function Home() {
  return (
    <main
      style={{
        maxWidth: 'var(--layout-max-width)',
        margin: '0 auto',
        padding: 'var(--sp-8) var(--sp-4)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--fs-title)',
          lineHeight: 'var(--lh-tight)',
          color: 'var(--c-text-strong)',
          margin: 0,
        }}
      >
        RoveringNow
      </h1>
      <p style={{ color: 'var(--c-text-muted)', marginTop: 'var(--sp-3)' }}>
        連絡が届き、活動が記録され、仲間が集まる
      </p>
      <p style={{ color: 'var(--c-text-subtle)', fontSize: 'var(--fs-small)' }}>
        工程2-1（基盤）を実装中です。
      </p>
    </main>
  );
}
