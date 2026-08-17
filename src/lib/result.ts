/**
 * 操作の結果
 *
 * 例外を投げず、成功と失敗を型で表す（決定 T-39）。
 * 呼び出し側は ok を確認しなければ data に到達できないため、
 * 失敗の処理漏れが型検査で見つかる。
 */

/** 04_api_spec.md 第3.1節のエラーコード */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'GROUP_NAME_TAKEN',
  'GROUP_NOT_ACTIVE',
  'STAMP_NOT_IN_PERIOD',
  'STAMP_ALREADY_GRANTED',
  'LAST_ADMIN',
  'PARENT_CYCLE',
  'PARENT_REQUEST_PENDING',
  'EXCHANGE_UNAVAILABLE',
  'RATE_LIMITED',
  'CONFLICT',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; details?: unknown };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Result<T> {
  return details === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, details };
}

/**
 * 利用者に見せる既定の文言。
 *
 * 内部状態を漏らさないことを優先する（04_api_spec.md 第3.2節）。
 * とくに EXCHANGE_UNAVAILABLE は、ブロックされている場合と相手が存在しない場合を
 * 区別できない文言にしてある。
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'ログインが必要です。',
  FORBIDDEN: 'この操作を行う権限がありません。',
  NOT_FOUND: '対象が見つかりませんでした。',
  VALIDATION_FAILED: '入力内容を確認してください。',
  GROUP_NAME_TAKEN: 'この名前はすでに使われています。',
  GROUP_NOT_ACTIVE: 'このグループは活動を終えているため、操作できません。',
  STAMP_NOT_IN_PERIOD: 'このスタンプの取得期間ではありません。',
  STAMP_ALREADY_GRANTED: 'このスタンプはすでに獲得しています。',
  LAST_ADMIN: 'あなたはこのグループの唯一の管理者です。先に後任を決めてください。',
  PARENT_CYCLE: 'このグループを親に設定することはできません。',
  PARENT_REQUEST_PENDING: 'すでに申請中の親グループがあります。',
  EXCHANGE_UNAVAILABLE: 'このカードは読み取れませんでした。',
  RATE_LIMITED: '操作の回数が上限に達しました。しばらく待ってからお試しください。',
  CONFLICT: '内容が更新されています。読み込み直してください。',
  INTERNAL: '処理中に問題が発生しました。時間をおいてお試しください。',
};
