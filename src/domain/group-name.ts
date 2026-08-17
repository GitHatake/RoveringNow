/**
 * グループ名の正規化と検証
 *
 * グループ名は全国で一意である（決定21）。一意性はデータベースの UNIQUE 制約で
 * 担保するが（決定 T-10）、その判定に用いる正規化規則をここに定める。
 *
 * 正規化を誤ると、見た目が同じで実体が異なる名前を別物として登録できてしまい、
 * 名称の占拠（基本設計書 第12.3節）を防げなくなる。
 */

/**
 * 制御文字（Cc）と書式文字（Cf）。
 *
 * 除去する理由は 2 つある。
 * 1. なりすまし対策 — U+202E（右横書き優先）などの書式文字は表示上の文字順を
 *    反転させられるため、実在組織名に見せかけた別名を作れてしまう
 * 2. 一意性の担保 — U+200B（ゼロ幅スペース）等は見えないまま文字列を変えるため、
 *    「夏キャンプ」と「夏キャン<ZWSP>プ」を別名として登録できてしまう
 *
 * 絵文字の ZWJ 連結（U+200D）も除去対象に含まれるが、影響を受けるのは
 * 正規化後の比較用文字列のみで、表示名は入力どおりに保持される。
 */
const CONTROL_AND_FORMAT = /[\p{Cc}\p{Cf}]/gu;

/** 連続する空白（U+3000 や NBSP を含む） */
const WHITESPACE_RUN = /\s+/gu;

/** 表示名として許す最大の長さ（コードポイント数） */
export const GROUP_NAME_MAX_LENGTH = 60;

/**
 * 正規化後の最大長。
 * NFKC は一部の文字を大きく展開するため（例：U+FDFA は 18 文字になる）、
 * 表示名の上限だけでは正規化後の長さを抑えられない。索引に載らない長さの
 * 文字列が生まれることを防ぐための上限。
 */
const NORMALIZED_MAX_LENGTH = 200;

/** コードポイント数を数える（サロゲートペアを 1 と数える） */
function lengthInCodePoints(value: string): number {
  return Array.from(value).length;
}

/**
 * 表示用に整える。データベースの `groups.name` に格納する値。
 *
 * 見た目を変えない範囲（NFC）にとどめ、利用者が入力した表記を尊重する。
 */
export function sanitizeGroupName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(CONTROL_AND_FORMAT, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/**
 * 一意性の判定用に正規化する。データベースの `groups.name_normalized` に格納する値。
 *
 * 詳細設計 03_db_schema.md 第4.3節の規則：
 * 1. 前後の空白を除去し、連続する空白を 1 つにまとめる
 * 2. Unicode 正規化（NFKC）— 全角英数字が半角に統一される
 * 3. 英字を小文字に統一する
 */
export function normalizeGroupName(raw: string): string {
  return (
    sanitizeGroupName(raw)
      .normalize('NFKC')
      // NFKC により新たな空白が生じうるため（U+3000 → U+0020 など）畳み直す
      .replace(WHITESPACE_RUN, ' ')
      .trim()
      // ロケールに依存しない小文字化を用いる
      .toLowerCase()
  );
}

export type GroupNameError =
  | 'empty'
  | 'too_long'
  | 'normalized_empty'
  | 'normalized_too_long';

export type GroupNameCheck =
  | { ok: true; name: string; normalized: string }
  | { ok: false; error: GroupNameError };

/**
 * グループ名を検証し、格納する 2 つの表現を返す。
 *
 * `normalized_empty` は、入力が空白や書式文字だけで構成されていた場合に起きる。
 * 表示名としては文字があるように見えても、比較用の文字列が空になるため受け付けない。
 */
export function checkGroupName(raw: string): GroupNameCheck {
  const name = sanitizeGroupName(raw);
  if (name.length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (lengthInCodePoints(name) > GROUP_NAME_MAX_LENGTH) {
    return { ok: false, error: 'too_long' };
  }

  const normalized = normalizeGroupName(raw);
  if (normalized.length === 0) {
    return { ok: false, error: 'normalized_empty' };
  }
  if (lengthInCodePoints(normalized) > NORMALIZED_MAX_LENGTH) {
    return { ok: false, error: 'normalized_too_long' };
  }

  return { ok: true, name, normalized };
}

/**
 * 代替名の候補を作る（決定21・デザインシステム 第6.7節）。
 *
 * グループ名を全国一意にしたことで、一般的な名前は早い者勝ちで埋まる。
 * これは利用者の間違いではないため、エラーとして示すのではなく候補を提案して
 * 作成の手軽さ（プロダクト原則2）を保つ。
 *
 * @param base 利用者が入力した名前
 * @param hints 付加する手がかり（親グループ名・地域名・年など）
 * @param isAvailable 候補が使用可能かを判定する関数
 */
export async function suggestAlternativeNames(
  base: string,
  hints: readonly string[],
  isAvailable: (normalized: string) => Promise<boolean>,
): Promise<string[]> {
  const sanitizedBase = sanitizeGroupName(base);
  if (sanitizedBase.length === 0) return [];

  const suggestions: string[] = [];
  const seen = new Set<string>();

  for (const hint of hints) {
    if (suggestions.length >= 3) break;

    const sanitizedHint = sanitizeGroupName(hint);
    if (sanitizedHint.length === 0) continue;

    const candidate = `${sanitizedBase}（${sanitizedHint}）`;
    const check = checkGroupName(candidate);
    if (!check.ok) continue;
    if (seen.has(check.normalized)) continue;
    seen.add(check.normalized);

    if (await isAvailable(check.normalized)) {
      suggestions.push(check.name);
    }
  }

  return suggestions;
}
